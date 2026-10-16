import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabasePool } from "@dabboba/db";
import type { ApiConfig } from "@dabboba/config";
import { beginIdempotency, completeIdempotency, requestHash } from "./lib/idempotency.js";
import { selectCardChannel, isPortOneCardProvider } from "./lib/portone-channel-binding.js";
import { applyCanonicalPaymentEventInTransaction, parseCanonicalPaymentEvent } from "./modules/commerce.js";

/** Historical fixtures only: the current purchase endpoint never sells legacy draws.
 * Read/refund/consume tests seed the old order, then exercise the real current APIs.
 * This file is not imported by the server and admits loopback disposable DBs only.
 */
export async function historicalOrderFixture(
  app: FastifyInstance, pool: DatabasePool, config: ApiConfig,
  request: { headers: Record<string, string>; payload: {
    items: Array<{productId: string; quantity: number; expectedDrawVersion?: number}>;
    pointAmount?: number; couponCode?: string; kujiRoomEntryId?: string;
  }; method?: string; url?: string },
) {
  assert.equal(process.env.DABBOBA_ENVIRONMENT_TIER, "TEST");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.databaseUrl).hostname));
  const me = await app.inject({method: "GET", url: "/v1/auth/me", headers: request.headers});
  assert.equal(me.statusCode, 200, me.body);
  const userId = me.json().actor.userId as string;
  const input = request.payload;
  const orderId = await withTransaction(pool, async client => {
    const products = [];
    for (const item of input.items) {
      const row = (await client.query(`SELECT p.id,p.name,p.category,p.price,s.on_hand,s.reserved,
        (SELECT id FROM draw_probability_versions WHERE product_id=p.id AND status='ACTIVE') AS version_id
        FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p,s`, [item.productId])).rows[0];
      assert.ok(row, item.productId);
      assert.ok(row.on_hand-row.reserved >= item.quantity, "historical fixture stock");
      products.push({...row, quantity:item.quantity});
    }
    const subtotal=products.reduce((sum,p)=>sum+p.price*p.quantity,0), points=input.pointAmount ?? 0;
    let couponId: string | null=null, discount=0;
    if(input.couponCode) {
      const coupon=(await client.query("SELECT * FROM coupons WHERE code=$1 FOR UPDATE",[input.couponCode])).rows[0];
      assert.ok(coupon);
      couponId=coupon.id;
      discount=coupon.discount_type==='FIXED'?coupon.discount_value:Math.floor(subtotal*coupon.discount_value/100);
      if(coupon.maximum_discount!==null)discount=Math.min(discount,coupon.maximum_discount);
      discount=Math.min(subtotal,discount);
      await client.query("UPDATE coupons SET used_count=used_count+1 WHERE id=$1",[couponId]);
    }
    const total=subtotal-discount-points;
    assert.ok(total>=0);
    if(points) {
      const debit=await client.query("UPDATE point_accounts SET balance=balance-$2,version=version+1 WHERE user_id=$1 AND balance>=$2 RETURNING user_id",[userId,points]);
      assert.equal(debit.rowCount,1);
    }
    const id=(await client.query("INSERT INTO orders(user_id,subtotal,discount_total,point_total,total,coupon_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[userId,subtotal,discount,points,total,couponId])).rows[0].id as string;
    let deadline: Date | null=null;
    if(input.kujiRoomEntryId) {
      const entry=await client.query("UPDATE kuji_room_entries SET order_id=$2 WHERE id=$1 AND user_id=$3 AND state='CHECKOUT_PENDING' AND order_id IS NULL RETURNING checkout_expires_at",[input.kujiRoomEntryId,id,userId]);
      assert.equal(entry.rowCount,1);
      deadline=entry.rows[0].checkout_expires_at;
    }
    for(const p of products) {
      const line=(await client.query("INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[id,p.id,p.name,p.category,p.version_id,p.price,p.quantity,p.price*p.quantity])).rows[0].id;
      await client.query("UPDATE product_stock SET reserved=reserved+$2,version=version+1 WHERE product_id=$1",[p.id,p.quantity]);
      await client.query("INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()+interval '15 minutes'))",[id,line,p.id,p.quantity,deadline]);
    }
    if(points)await client.query("INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason) VALUES($1,'SPEND',$2,'ORDER',$3,'Historical integration fixture')",[userId,-points,id]);
    if(couponId)await client.query("INSERT INTO coupon_redemptions(coupon_id,user_id,order_id,discount_amount) VALUES($1,$2,$3,$4)",[couponId,userId,id,discount]);
    const binding=total>0&&isPortOneCardProvider(config.paymentProvider)?selectCardChannel(config):null;
    const provider=total===0?'INTERNAL_ZERO':binding?.provider ?? config.paymentProvider;
    const payment=(await client.query("INSERT INTO payments(order_id,provider,amount,portone_channel_binding) VALUES($1,$2,$3,$4::jsonb) RETURNING id",[id,provider,total,binding?JSON.stringify(binding):null])).rows[0].id;
    if(total===0)await applyCanonicalPaymentEventInTransaction(client,parseCanonicalPaymentEvent(provider,{eventId:`historical-fixture:${randomUUID()}`,eventType:'PAYMENT_SUCCEEDED',paymentId:payment,amount:0,occurredAt:new Date().toISOString()},'disposable-historical-fixture'),'historical-fixture');
    return id;
  });
  const read=await app.inject({method:'GET',url:`/v1/orders/${orderId}`,headers:request.headers});
  assert.equal(read.statusCode,200,read.body);
  // Preserve the completed legacy request identity so current API retries still
  // read the historical response before applying the new-purchase restriction.
  const key=request.headers["idempotency-key"];
  if(key)await withTransaction(pool,async client=>{
    const normalized={items:input.items.map(item=>({...item,expectedDrawVersion:item.expectedDrawVersion??null})).sort((a,b)=>a.productId.localeCompare(b.productId)),couponCode:input.couponCode,pointAmount:input.pointAmount??0,kujiRoomEntryId:input.kujiRoomEntryId??null};
    const idem=await beginIdempotency(client,{actorId:userId,scope:"CREATE_ORDER",key,hash:requestHash(normalized)});
    assert.ok(idem.fresh);
    await completeIdempotency(client,idem.id,{statusCode:201,body:read.json(),resourceType:"ORDER",resourceId:orderId});
  });
  // Compatibility shape for test setup callers; all order fields come from the real owner-scoped GET.
  return {statusCode:201,body:read.body,headers:read.headers,json:()=>read.json()};
}
