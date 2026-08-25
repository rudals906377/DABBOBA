import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { commerceModeForCategory } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { assertDrawCapacity } from "../lib/draw-capacity.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { enumInput, integerInput, nullableStringInput, objectInput, slugIdInput, stringInput, uuidInput } from "../lib/input.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

type ProductOrderRow = {
  id: string; name: string; category: "gacha" | "figure" | "kuji" | "tcg"; price: number;
  is_active: boolean; on_hand: number; reserved: number; probability_version_id: string | null;
  probability_version: number | null;
};
type OrderRow = {
  id: string; user_id: string; status: string; currency: "KRW"; subtotal: number; discount_total: number;
  point_total: number; total: number; created_at: Date; updated_at: Date; payment_id: string;
};
type OrderLineRow = {
  id: string; product_id: string; product_name_snapshot: string; category_snapshot: "gacha" | "figure" | "kuji" | "tcg";
  unit_price: number; quantity: number; line_total: number; probability_version_id: string | null;
};
type DrawVersionRow = {
  id: string;
  product_id: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  published_by: string | null;
  published_at: Date | null;
  created_at: Date;
  entries: Array<{
    id: string;
    prizeProductId: string;
    rarity: string;
    weight: number;
    initialQuantity: number | null;
    remainingQuantity: number | null;
  }>;
};

function isDrawCategory(category: "gacha" | "figure" | "kuji" | "tcg") {
  return commerceModeForCategory(category) === "draw";
}

export function refundRequiresReview(input:{unsafeAssetCount:number;expectedPurchaseUnits:number;actualPurchaseUnits:number;expectedDrawUnits?:number;actualDrawUnits?:number}){
  return input.unsafeAssetCount>0||input.expectedPurchaseUnits!==input.actualPurchaseUnits||(input.expectedDrawUnits??0)!==(input.actualDrawUnits??0);
}

export function shouldRelistRefundedDrawStock(refundedVersionId:string|null,activeVersionId:string|null){
  return activeVersionId===null||refundedVersionId===activeVersionId;
}

export function paymentProviderForOrder(configuredProvider:string,total:number){
  if(total===0)return "INTERNAL_ZERO";
  if(configuredProvider==="UNCONFIGURED"||configuredProvider==="INTERNAL_ZERO")throw new AppError(503,"PAYMENT_NOT_CONFIGURED","결제 공급자가 구성되지 않았습니다.");
  return configuredProvider;
}

export const CHECKOUT_RESERVATION_LIMITS={attemptsPer15Minutes:12,activeOrders:3,activeUnits:10,activeUnitsPerProduct:5} as const;

export function checkoutReservationViolation(input:{attemptCount:number;activeOrderCount:number;activeUnitCount:number;requestedUnitCount:number;productQuantities:Array<{active:number;requested:number}>}){
  if(input.attemptCount>=CHECKOUT_RESERVATION_LIMITS.attemptsPer15Minutes)return "ATTEMPT_RATE" as const;
  if(input.activeOrderCount>=CHECKOUT_RESERVATION_LIMITS.activeOrders)return "ACTIVE_ORDERS" as const;
  if(input.activeUnitCount+input.requestedUnitCount>CHECKOUT_RESERVATION_LIMITS.activeUnits)return "ACTIVE_UNITS" as const;
  if(input.productQuantities.some((item)=>item.active+item.requested>CHECKOUT_RESERVATION_LIMITS.activeUnitsPerProduct))return "PRODUCT_UNITS" as const;
  return null;
}

const DRAW_ENTROPY_BYTES = 32;
const DRAW_ENTROPY_SPACE = 1n << BigInt(DRAW_ENTROPY_BYTES * 8);
export const DRAW_SELECTION_ALGORITHM = "SHA256_REJECTION_V1";

export type DrawSelectionEvidence = {
  algorithm: typeof DRAW_SELECTION_ALGORITHM;
  entropyHex: string;
  entropyDigest: string;
  roll: number;
  totalWeight: number;
};

/**
 * Maps one 256-bit sample to a uniform roll. Samples in the incomplete tail are
 * rejected instead of reduced with modulo bias.
 */
export function drawRollFromEntropy(entropy: Uint8Array, totalWeight: number): number | null {
  if (entropy.byteLength !== DRAW_ENTROPY_BYTES) throw new RangeError("Draw entropy must be exactly 32 bytes.");
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new RangeError("Draw total weight must be a positive safe integer.");
  const entropyHex = Buffer.from(entropy).toString("hex");
  const sample = BigInt(`0x${entropyHex}`);
  const range = BigInt(totalWeight);
  const unbiasedCeiling = DRAW_ENTROPY_SPACE - (DRAW_ENTROPY_SPACE % range);
  if (sample >= unbiasedCeiling) return null;
  return Number(sample % range);
}

export function createDrawSelectionEvidence(
  totalWeight: number,
  entropySource: (size: number) => Uint8Array = randomBytes,
): DrawSelectionEvidence {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const entropy = entropySource(DRAW_ENTROPY_BYTES);
    const roll = drawRollFromEntropy(entropy, totalWeight);
    if (roll === null) continue;
    const entropyBuffer = Buffer.from(entropy);
    return {
      algorithm: DRAW_SELECTION_ALGORITHM,
      entropyHex: entropyBuffer.toString("hex"),
      entropyDigest: createHash("sha256").update(entropyBuffer).digest("hex"),
      roll,
      totalWeight,
    };
  }
  throw new Error("Unable to obtain an unbiased draw entropy sample.");
}

export function weightedSelectionIndex(effectiveWeights: readonly number[], roll: number): number {
  if (!Number.isSafeInteger(roll) || roll < 0) throw new RangeError("Draw roll must be a non-negative safe integer.");
  let cursor = roll;
  for (const [index, weight] of effectiveWeights.entries()) {
    if (!Number.isSafeInteger(weight) || weight <= 0) throw new RangeError("Draw weights must be positive safe integers.");
    if (cursor < weight) return index;
    cursor -= weight;
  }
  throw new RangeError("Draw roll exceeds the configured weight range.");
}

async function orderResponse(queryable: Queryable, orderId: string, ownerId?: string) {
  const values: unknown[] = [orderId];
  const ownerFilter = ownerId ? (values.push(ownerId), `AND o.user_id=$${values.length}`) : "";
  const order = await queryable.query<OrderRow>(
    `SELECT o.*,p.id AS payment_id FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 ${ownerFilter}`,
    values,
  );
  if (!order.rowCount) throw notFound("주문을 찾을 수 없습니다.");
  const row = order.rows[0]!;
  const lines = await queryable.query<OrderLineRow>("SELECT * FROM order_lines WHERE order_id=$1 ORDER BY created_at,id",[orderId]);
  const entitlements = await queryable.query<{id:string}>("SELECT id FROM draw_entitlements WHERE order_line_id=ANY($1::uuid[]) ORDER BY created_at,id",[lines.rows.map((line)=>line.id)]);
  return {
    id:row.id,userId:row.user_id,paymentId:row.payment_id,status:row.status,currency:row.currency,
    subtotal:numberValue(row.subtotal),discountTotal:numberValue(row.discount_total),pointTotal:numberValue(row.point_total),total:numberValue(row.total),
    lines:lines.rows.map((line)=>({productId:line.product_id,productName:line.product_name_snapshot,category:line.category_snapshot,unitPrice:numberValue(line.unit_price),quantity:numberValue(line.quantity),lineTotal:numberValue(line.line_total)})),
    drawEntitlementIds:entitlements.rows.map((item)=>item.id),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),
  };
}

function parseOrderInput(body: unknown) {
  const input=objectInput(body);if(!Array.isArray(input.items)||input.items.length<1||input.items.length>20)throw badRequest("주문 상품을 확인해 주세요.");
  const combined=new Map<string,{quantity:number;expectedDrawVersion:number|null}>();for(const raw of input.items){const item=objectInput(raw);const productId=slugIdInput(item.productId,"productId");const quantity=integerInput(item,"quantity",{min:1,max:20})!;const expectedDrawVersion=integerInput(item,"expectedDrawVersion",{min:1,max:2_147_483_647,optional:true})??null;const existing=combined.get(productId);if(existing&&existing.expectedDrawVersion!==expectedDrawVersion)throw badRequest("같은 상품의 확률표 버전이 일치하지 않습니다.");combined.set(productId,{quantity:(existing?.quantity||0)+quantity,expectedDrawVersion});}
  for(const item of combined.values())if(item.quantity>20)throw badRequest("상품별 최대 수량은 20개입니다.");
  return {items:[...combined.entries()].map(([productId,item])=>({productId,...item})).sort((a,b)=>a.productId.localeCompare(b.productId)),couponCode:nullableStringInput(input,"couponCode",{max:60}),pointAmount:integerInput(input,"pointAmount",{min:0,max:2_147_483_647,optional:true})||0};
}

async function releasePendingOrder(client:DatabaseClient,order:OrderRow,reason:string){
  const reservations=await client.query<{id:string;product_id:string;quantity:number}>("SELECT id,product_id,quantity FROM stock_reservations WHERE order_id=$1 AND status='ACTIVE' ORDER BY product_id,id FOR UPDATE",[order.id]);
  for(const reservation of reservations.rows){await client.query("UPDATE product_stock SET reserved=reserved-$2,version=version+1 WHERE product_id=$1 AND reserved>=$2",[reservation.product_id,reservation.quantity]);}
  await client.query("UPDATE stock_reservations SET status='RELEASED',resolved_at=now() WHERE id=ANY($1::uuid[]) AND status='ACTIVE'",[reservations.rows.map((reservation)=>reservation.id)]);
  const coupon=await client.query<{coupon_id:string}>("UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED' RETURNING coupon_id",[order.id]);
  if(coupon.rowCount)await client.query("UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE id=$1",[coupon.rows[0]!.coupon_id]);
  if(numberValue(order.point_total)>0){const ledger=await client.query("INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason) VALUES($1,'REFUND',$2,'ORDER',$3,$4) ON CONFLICT DO NOTHING RETURNING id",[order.user_id,order.point_total,order.id,reason]);if(ledger.rowCount)await client.query("UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",[order.user_id,order.point_total]);}
}

async function recordPaymentLedger(client:DatabaseClient,pay:{id:string;amount:number},orderId:string,eventId:string,reason:string){if(numberValue(pay.amount)<=0)return;await client.query("INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id,reason) SELECT $1,$2,'PAYMENT',$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM payment_ledger_entries WHERE payment_id=$1 AND entry_type='PAYMENT')",[pay.id,orderId,pay.amount,eventId,reason]);}

async function recordRefundLedger(client:DatabaseClient,pay:{id:string;amount:number},orderId:string,eventId:string,reason:string){if(numberValue(pay.amount)<=0)return;await client.query("INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id,reason) SELECT $1,$2,'REFUND',$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM payment_ledger_entries WHERE payment_id=$1 AND entry_type='REFUND')",[pay.id,orderId,-numberValue(pay.amount),eventId,reason]);}

type RefundAssetSnapshot={
  lines:OrderLineRow[];
  inventoryIds:string[];
  entitlementIds:string[];
  activeDrawVersionByProduct:Map<string,string|null>;
  safety:{unsafeAssetCount:number;expectedPurchaseUnits:number;actualPurchaseUnits:number;expectedDrawUnits:number;actualDrawUnits:number};
};

async function lockRefundAssets(client:DatabaseClient,order:OrderRow):Promise<RefundAssetSnapshot>{
  const lines=await client.query<OrderLineRow>("SELECT * FROM order_lines WHERE order_id=$1 ORDER BY product_id,id FOR UPDATE",[order.id]);const lineIds=lines.rows.map((line)=>line.id);
  const productIds=[...new Set(lines.rows.map((line)=>line.product_id))].sort();
  if(productIds.length){await client.query("SELECT p.id FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=ANY($1::text[]) ORDER BY p.id FOR UPDATE OF p,s",[productIds]);}
  const drawLines=lines.rows.filter((line)=>isDrawCategory(line.category_snapshot));
  const drawProductIds=[...new Set(drawLines.map((line)=>line.product_id))].sort();
  const refundedVersionIds=[...new Set(drawLines.map((line)=>line.probability_version_id).filter((id):id is string=>id!==null))].sort();
  const versions=drawProductIds.length?await client.query<{id:string;product_id:string;status:string}>(`SELECT id,product_id,status FROM draw_probability_versions
    WHERE id=ANY($1::uuid[]) OR (product_id=ANY($2::text[]) AND status='ACTIVE') ORDER BY id FOR UPDATE`,[refundedVersionIds,drawProductIds]):{rows:[]};
  const versionIds=[...new Set(versions.rows.map((version)=>version.id))].sort();
  for(const versionId of versionIds){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[`draw-capacity:${versionId}`]);}
  const activeDrawVersionByProduct=new Map<string,string|null>(drawProductIds.map((productId)=>[productId,null]));
  for(const version of versions.rows){if(version.status==="ACTIVE")activeDrawVersionByProduct.set(version.product_id,version.id);}
  const inventory=await client.query<{id:string;owner_id:string;status:string}>("SELECT id,owner_id,status FROM inventory_units WHERE source_type='PURCHASE' AND source_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[lineIds]);
  const entitlements=await client.query<{id:string;status:string}>("SELECT id,status FROM draw_entitlements WHERE order_line_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[lineIds]);
  const expectedPurchaseUnits=lines.rows.filter((line)=>!isDrawCategory(line.category_snapshot)).reduce((sum,line)=>sum+numberValue(line.quantity),0);const expectedDrawUnits=lines.rows.filter((line)=>isDrawCategory(line.category_snapshot)).reduce((sum,line)=>sum+numberValue(line.quantity),0);
  const unsafeAssetCount=inventory.rows.filter((item)=>item.status!=="OWNED"||item.owner_id!==order.user_id).length+entitlements.rows.filter((item)=>item.status!=="AVAILABLE").length;
  return{lines:lines.rows,inventoryIds:inventory.rows.map((item)=>item.id),entitlementIds:entitlements.rows.map((item)=>item.id),activeDrawVersionByProduct,safety:{unsafeAssetCount,expectedPurchaseUnits,actualPurchaseUnits:inventory.rows.length,expectedDrawUnits,actualDrawUnits:entitlements.rows.length}};
}

function signatureMatches(rawBody:Buffer,header:string,secret:string){const expected=createHmac("sha256",secret).update(rawBody).digest("hex");const supplied=header.startsWith("sha256=")?header.slice(7):header;if(!/^[0-9a-f]{64}$/i.test(supplied))return false;return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(supplied,"hex"));}

export async function registerCommerceRoutes(app:FastifyInstance,context:ApiContext){
  app.get("/v1/catalog/products/:productId/draw-odds",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const productId=slugIdInput((request.params as Record<string,unknown>).productId,"productId");
    const version=await context.pool.query<{id:string;product_id:string;version:number;published_at:Date}>(`SELECT v.id,v.product_id,v.version,v.published_at
      FROM draw_probability_versions v
      JOIN catalog_products p ON p.id=v.product_id
      WHERE v.product_id=$1 AND v.status='ACTIVE' AND p.is_active=true AND p.category IN ('gacha','kuji')`,[productId]);
    if(!version.rowCount)throw notFound("공개 중인 가챠·쿠지 확률표를 찾을 수 없습니다.");
    const active=version.rows[0]!;
    const entries=await context.pool.query<{id:string;prize_product_id:string;prize_name:string;prize_image_url:string|null;rarity:string;weight:number;initial_quantity:number|null;remaining_quantity:number|null}>(`SELECT e.id,e.prize_product_id,p.name AS prize_name,p.image_url AS prize_image_url,e.rarity,e.weight,e.initial_quantity,e.remaining_quantity
      FROM draw_pool_entries e
      JOIN catalog_products p ON p.id=e.prize_product_id
      WHERE e.probability_version_id=$1
      ORDER BY e.rarity,e.id`,[active.id]);
    const weighted=entries.rows.map((entry)=>({entry,effectiveWeight:numberValue(entry.weight)*(entry.remaining_quantity===null?1:numberValue(entry.remaining_quantity))}));
    const totalEffectiveWeight=weighted.reduce((sum,item)=>sum+item.effectiveWeight,0);
    if(!Number.isSafeInteger(totalEffectiveWeight)||totalEffectiveWeight<=0)throw conflict("현재 확률표를 안전하게 계산할 수 없습니다.");
    return{id:active.id,productId:active.product_id,version:numberValue(active.version),publishedAt:iso(active.published_at),calculatedAt:new Date().toISOString(),calculation:"WEIGHT_X_REMAINING_QUANTITY",totalEffectiveWeight,entries:weighted.map(({entry,effectiveWeight})=>({id:entry.id,prizeProductId:entry.prize_product_id,prizeName:entry.prize_name,prizeImageUrl:entry.prize_image_url,rarity:entry.rarity,weight:numberValue(entry.weight),initialQuantity:entry.initial_quantity===null?null:numberValue(entry.initial_quantity),remainingQuantity:entry.remaining_quantity===null?null:numberValue(entry.remaining_quantity),effectiveWeight,probabilityNumerator:effectiveWeight,probabilityDenominator:totalEffectiveWeight,probabilityPercent:Math.round((effectiveWeight/totalEffectiveWeight)*100_000_000)/1_000_000}))};
  });

  app.post("/v1/orders",{preHandler:context.auth.requireUser},async(request,reply)=>{
    const input=parseOrderInput(request.body);const key=idempotencyKey(request.headers);const hash=requestHash(input);
    const result=await withTransaction(context.pool,async(client)=>{const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CREATE_ORDER",key,hash});if(!idem.fresh)return {replay:true,statusCode:idem.statusCode,body:idem.body};
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[`checkout:${request.actor!.userId}`]);
      const pressure=await client.query<{attempt_count:string;active_order_count:string;active_unit_count:string}>(`SELECT
        (SELECT count(*) FROM orders WHERE user_id=$1 AND created_at>=now()-interval '15 minutes') AS attempt_count,
        (SELECT count(DISTINCT r.order_id) FROM stock_reservations r JOIN orders o ON o.id=r.order_id WHERE o.user_id=$1 AND o.status='PENDING_PAYMENT' AND r.status='ACTIVE' AND r.expires_at>now()) AS active_order_count,
        (SELECT COALESCE(sum(r.quantity),0) FROM stock_reservations r JOIN orders o ON o.id=r.order_id WHERE o.user_id=$1 AND o.status='PENDING_PAYMENT' AND r.status='ACTIVE' AND r.expires_at>now()) AS active_unit_count`,[request.actor!.userId]);
      const activeProducts=await client.query<{product_id:string;quantity:string}>(`SELECT r.product_id,sum(r.quantity) AS quantity FROM stock_reservations r JOIN orders o ON o.id=r.order_id WHERE o.user_id=$1 AND o.status='PENDING_PAYMENT' AND r.status='ACTIVE' AND r.expires_at>now() GROUP BY r.product_id`,[request.actor!.userId]);const activeByProduct=new Map(activeProducts.rows.map((row)=>[row.product_id,numberValue(row.quantity)]));const pressureRow=pressure.rows[0]!;const violation=checkoutReservationViolation({attemptCount:numberValue(pressureRow.attempt_count),activeOrderCount:numberValue(pressureRow.active_order_count),activeUnitCount:numberValue(pressureRow.active_unit_count),requestedUnitCount:input.items.reduce((sum,item)=>sum+item.quantity,0),productQuantities:input.items.map((item)=>({active:activeByProduct.get(item.productId)||0,requested:item.quantity}))});
      if(violation==="ATTEMPT_RATE")throw new AppError(429,"CHECKOUT_RATE_LIMITED","15분 뒤 다시 주문해 주세요.");if(violation)throw conflict("미결제 재고 예약 한도를 초과했습니다. 기존 주문을 결제하거나 만료 후 다시 시도해 주세요.");
      const productRows:ProductOrderRow[]=[];for(const item of input.items){const product=await client.query<ProductOrderRow>(`SELECT p.id,p.name,p.category,p.price,p.is_active,s.on_hand,s.reserved,
          (SELECT v.id FROM draw_probability_versions v WHERE v.product_id=p.id AND v.status='ACTIVE') AS probability_version_id,
          (SELECT v.version FROM draw_probability_versions v WHERE v.product_id=p.id AND v.status='ACTIVE') AS probability_version
          FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p,s`,[item.productId]);if(!product.rowCount||!product.rows[0]!.is_active)throw notFound(`판매 중인 상품을 찾을 수 없습니다: ${item.productId}`);const row=product.rows[0]!;if(row.on_hand-row.reserved<item.quantity)throw conflict(`${row.name} 재고가 부족합니다.`);if(isDrawCategory(row.category)){if(!row.probability_version_id||row.probability_version===null)throw conflict(`${row.name} 추첨 확률표가 아직 공개되지 않았습니다.`);if(item.expectedDrawVersion===null)throw badRequest(`${row.name} 결제 전 확인한 확률표 버전이 필요합니다.`);if(numberValue(row.probability_version)!==item.expectedDrawVersion)throw conflict(`${row.name} 확률표가 변경됐습니다. 최신 경품·확률을 다시 확인해 주세요.`);}else if(item.expectedDrawVersion!==null)throw badRequest("일반 구매 상품에는 확률표 버전을 보낼 수 없습니다.");if(row.probability_version_id)await assertDrawCapacity(client,{probabilityVersionId:row.probability_version_id,productId:row.id,onHand:numberValue(row.on_hand)});productRows.push(row);}
      const subtotal=input.items.reduce((sum,item)=>sum+productRows.find((product)=>product.id===item.productId)!.price*item.quantity,0);let couponId:string|null=null;let discountTotal=0;
      if(input.couponCode){const coupon=await client.query<{id:string;discount_type:"FIXED"|"PERCENT";discount_value:number;maximum_discount:number|null;minimum_order:number;usage_limit:number|null;used_count:number}>(`SELECT id,discount_type,discount_value,maximum_discount,minimum_order,usage_limit,used_count FROM coupons WHERE code=$1 AND is_active=true AND starts_at<=now() AND ends_at>now() FOR UPDATE`,[input.couponCode]);if(!coupon.rowCount)throw conflict("사용할 수 없는 쿠폰입니다.");const value=coupon.rows[0]!;if(subtotal<value.minimum_order||value.usage_limit!==null&&value.used_count>=value.usage_limit)throw conflict("쿠폰 사용 조건을 충족하지 못했습니다.");discountTotal=value.discount_type==="FIXED"?value.discount_value:Math.floor(subtotal*value.discount_value/100);if(value.maximum_discount!==null)discountTotal=Math.min(discountTotal,value.maximum_discount);discountTotal=Math.min(discountTotal,subtotal);couponId=value.id;await client.query("UPDATE coupons SET used_count=used_count+1 WHERE id=$1",[value.id]);}
      const afterDiscount=subtotal-discountTotal;if(input.pointAmount>afterDiscount)throw conflict("주문 금액보다 많은 포인트를 사용할 수 없습니다.");const orderTotal=afterDiscount-input.pointAmount;const paymentProvider=paymentProviderForOrder(context.config.paymentProvider,orderTotal);if(input.pointAmount>0){await client.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING",[request.actor!.userId]);const spent=await client.query("UPDATE point_accounts SET balance=balance-$2,version=version+1 WHERE user_id=$1 AND balance>=$2 RETURNING balance",[request.actor!.userId,input.pointAmount]);if(!spent.rowCount)throw conflict("사용 가능한 포인트가 부족합니다.");}
      const order=await client.query<{id:string}>("INSERT INTO orders(user_id,subtotal,discount_total,point_total,total,coupon_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[request.actor!.userId,subtotal,discountTotal,input.pointAmount,afterDiscount-input.pointAmount,couponId]);const orderId=order.rows[0]!.id;
      if(input.pointAmount>0)await client.query("INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason) VALUES($1,'SPEND',$2,'ORDER',$3,'Order point reservation')",[request.actor!.userId,-input.pointAmount,orderId]);
      for(const item of input.items){const product=productRows.find((candidate)=>candidate.id===item.productId)!;const line=await client.query<{id:string}>(`INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[orderId,product.id,product.name,product.category,product.probability_version_id,product.price,item.quantity,product.price*item.quantity]);await client.query("UPDATE product_stock SET reserved=reserved+$2,version=version+1 WHERE product_id=$1",[product.id,item.quantity]);await client.query("INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')",[orderId,line.rows[0]!.id,product.id,item.quantity]);}
      if(couponId)await client.query("INSERT INTO coupon_redemptions(coupon_id,user_id,order_id,discount_amount) VALUES($1,$2,$3,$4)",[couponId,request.actor!.userId,orderId,discountTotal]);const payment=await client.query<{id:string}>("INSERT INTO payments(order_id,provider,amount) VALUES($1,$2,$3) RETURNING id",[orderId,paymentProvider,orderTotal]);if(orderTotal===0){const lines=await client.query<OrderLineRow>("SELECT * FROM order_lines WHERE order_id=$1 ORDER BY product_id FOR UPDATE",[orderId]);for(const line of lines.rows){await client.query("UPDATE product_stock SET on_hand=on_hand-$2,reserved=reserved-$2,version=version+1 WHERE product_id=$1",[line.product_id,line.quantity]);await client.query("UPDATE stock_reservations SET status='COMMITTED',resolved_at=now() WHERE order_line_id=$1 AND status='ACTIVE'",[line.id]);if(isDrawCategory(line.category_snapshot)){for(let i=0;i<line.quantity;i+=1)await client.query("INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4)",[line.id,request.actor!.userId,line.product_id,line.probability_version_id]);}else{for(let i=0;i<line.quantity;i+=1)await client.query("INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,'PURCHASE',$3)",[request.actor!.userId,line.product_id,line.id]);}}await client.query("UPDATE coupon_redemptions SET status='COMMITTED' WHERE order_id=$1 AND status='RESERVED'",[orderId]);await client.query("UPDATE payments SET status='PAID',paid_at=now(),version=version+1 WHERE id=$1",[payment.rows[0]!.id]);await client.query("UPDATE orders SET status='PAID',paid_at=now(),version=version+1 WHERE id=$1",[orderId]);await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:orderId,eventType:"order.paid",payload:{orderId,userId:request.actor!.userId,zeroExternalPayment:true}});}else{await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:orderId,eventType:"order.created",payload:{orderId,paymentId:payment.rows[0]!.id,reservationExpiresInSeconds:900}});}const body=await orderResponse(client,orderId,request.actor!.userId);await completeIdempotency(client,idem.id,{statusCode:201,body,resourceType:"ORDER",resourceId:orderId});return {replay:false,statusCode:201,body};});
    if(result.replay)reply.header("x-idempotent-replay","true");return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/orders/:orderId",{preHandler:context.auth.requireUser},async(request)=>orderResponse(context.pool,uuidInput((request.params as Record<string,unknown>).orderId,"orderId"),request.actor!.userId));

  app.post("/v1/payments/webhooks/:provider",async(request,reply)=>{const provider=stringInput(request.params as Record<string,unknown>,"provider",{max:40})!;if(context.config.paymentProvider==="UNCONFIGURED"||!context.config.paymentWebhookSecret)throw new AppError(503,"PAYMENT_NOT_CONFIGURED","결제 웹훅이 구성되지 않았습니다.");if(provider==="INTERNAL_ZERO"||provider!==context.config.paymentProvider)throw forbidden("현재 구성된 결제 제공자가 아닙니다.");const signatureHeader=request.headers["x-dabboba-signature"];const signature=Array.isArray(signatureHeader)?signatureHeader[0]:signatureHeader;if(!signature||!request.rawBody||!signatureMatches(request.rawBody,signature,context.config.paymentWebhookSecret))throw unauthorized("결제 웹훅 서명이 유효하지 않습니다.");const body=objectInput(request.body);const eventId=stringInput(body,"eventId",{max:200})!;const eventType=enumInput(body,"eventType",["PAYMENT_SUCCEEDED","PAYMENT_FAILED","PAYMENT_CANCELLED","REFUND_SUCCEEDED"] as const)!;const paymentId=uuidInput(body.paymentId,"paymentId");const providerPaymentId=nullableStringInput(body,"providerPaymentId",{max:200});const occurredAt=new Date(stringInput(body,"occurredAt",{max:40})!);if(Number.isNaN(occurredAt.getTime()))throw badRequest("occurredAt 값을 확인해 주세요.");const amount=integerInput(body,"amount",{min:0})!;const signatureDigest=createHash("sha256").update(signature).digest("hex");
    const outcome=await withTransaction(context.pool,async(client)=>{const payment=await client.query<{id:string;order_id:string;provider:string;status:string;amount:number;provider_payment_id:string|null}>("SELECT id,order_id,provider,status,amount,provider_payment_id FROM payments WHERE id=$1 FOR UPDATE",[paymentId]);if(!payment.rowCount)throw notFound("결제 정보를 찾을 수 없습니다.");const pay=payment.rows[0]!;if(pay.provider!==provider)throw forbidden("결제 제공자가 일치하지 않습니다.");const inserted=await client.query<{id:string}>(`INSERT INTO payment_provider_events(provider,provider_event_id,event_type,payment_id,signature_digest,payload,occurred_at,processed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (provider,provider_event_id) DO NOTHING RETURNING id`,[provider,eventId,eventType,paymentId,signatureDigest,JSON.stringify(body),occurredAt]);if(!inserted.rowCount){const existingEvent=await client.query<{payment_id:string;event_type:string;payload_matches:boolean}>("SELECT payment_id,event_type,payload=$3::jsonb AS payload_matches FROM payment_provider_events WHERE provider=$1 AND provider_event_id=$2",[provider,eventId,JSON.stringify(body)]);const prior=existingEvent.rows[0];if(!prior||prior.payment_id!==paymentId||prior.event_type!==eventType||!prior.payload_matches)throw conflict("같은 결제 이벤트 ID의 내용이 일치하지 않습니다.");return "duplicate" as const;}const orderResult=await client.query<OrderRow & {cancelled_at:Date|null}>("SELECT o.*,p.id AS payment_id FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 FOR UPDATE OF o",[pay.order_id]);const order=orderResult.rows[0]!;
      const markReview=async(reason:string,payload:Record<string,unknown>={})=>{await client.query("UPDATE payments SET status='REFUND_REVIEW',provider_payment_id=COALESCE($2,provider_payment_id),version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null]);await client.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1",[order.id]);await writeOutbox(client,request.id,{aggregateType:"PAYMENT",aggregateId:pay.id,eventType:reason,payload:{paymentId:pay.id,orderId:order.id,providerEventId:eventId,...payload}});return "review" as const;};
      if(amount!==numberValue(pay.amount)){if(pay.status==="REFUNDED"){await writeOutbox(client,request.id,{aggregateType:"PAYMENT",aggregateId:pay.id,eventType:"payment.amount_mismatch_after_refund_observed",payload:{paymentId:pay.id,orderId:order.id,providerEventId:eventId,providerAmount:amount,ledgerAmount:numberValue(pay.amount),eventType}});return "ignored" as const;}return markReview("payment.amount_mismatch_requires_reconciliation",{providerAmount:amount,ledgerAmount:numberValue(pay.amount),eventType});}

      if(eventType==="PAYMENT_SUCCEEDED"){
        if(pay.status==="REFUNDED"){await writeOutbox(client,request.id,{aggregateType:"PAYMENT",aggregateId:pay.id,eventType:"payment.success_after_refund_observed",payload:{paymentId:pay.id,orderId:order.id,providerEventId:eventId}});return "ignored" as const;}
        if(pay.status==="PAID")return "processed" as const;
        if(["CANCELLED","FAILED","REFUND_REVIEW"].includes(pay.status)){if(pay.status!=="REFUND_REVIEW"){await client.query("UPDATE payments SET status='REFUND_REVIEW',provider_payment_id=COALESCE($2,provider_payment_id),paid_at=COALESCE(paid_at,$3),version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null,occurredAt]);await client.query("UPDATE orders SET status='REFUND_REVIEW',paid_at=COALESCE(paid_at,$2),version=version+1 WHERE id=$1",[order.id,occurredAt]);}await recordPaymentLedger(client,pay,order.id,eventId,"Verified late provider success");await writeOutbox(client,request.id,{aggregateType:"PAYMENT",aggregateId:pay.id,eventType:"payment.late_success_requires_reconciliation",payload:{paymentId:pay.id,orderId:order.id,providerEventId:eventId,previousPaymentStatus:pay.status}});return "review" as const;}
        if(!["PENDING","AUTHORIZED"].includes(pay.status))return markReview("payment.state_requires_reconciliation",{eventType,previousPaymentStatus:pay.status});
        const lines=await client.query<OrderLineRow>("SELECT * FROM order_lines WHERE order_id=$1 ORDER BY product_id FOR UPDATE",[order.id]);const reservations=await client.query<{order_line_id:string;product_id:string;quantity:number}>("SELECT order_line_id,product_id,quantity FROM stock_reservations WHERE order_id=$1 AND status='ACTIVE' ORDER BY product_id,order_line_id FOR UPDATE",[order.id]);const reservationByLine=new Map(reservations.rows.map((item)=>[item.order_line_id,item]));let reservationSafe=reservations.rows.length===lines.rows.length;for(const line of lines.rows){const reservation=reservationByLine.get(line.id);const stock=await client.query<{on_hand:number;reserved:number}>("SELECT on_hand,reserved FROM product_stock WHERE product_id=$1 FOR UPDATE",[line.product_id]);if(!reservation||reservation.product_id!==line.product_id||numberValue(reservation.quantity)!==numberValue(line.quantity)||!stock.rowCount||numberValue(stock.rows[0]!.on_hand)<numberValue(line.quantity)||numberValue(stock.rows[0]!.reserved)<numberValue(line.quantity))reservationSafe=false;}
        if(!reservationSafe){await recordPaymentLedger(client,pay,order.id,eventId,"Verified success without fulfillable reservation");return markReview("payment.fulfillment_requires_reconciliation",{previousPaymentStatus:pay.status});}
        for(const line of lines.rows){await client.query("UPDATE product_stock SET on_hand=on_hand-$2,reserved=reserved-$2,version=version+1 WHERE product_id=$1",[line.product_id,line.quantity]);await client.query("UPDATE stock_reservations SET status='COMMITTED',resolved_at=now() WHERE order_line_id=$1 AND status='ACTIVE'",[line.id]);if(isDrawCategory(line.category_snapshot)){for(let i=0;i<line.quantity;i+=1)await client.query("INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4)",[line.id,order.user_id,line.product_id,line.probability_version_id]);}else{for(let i=0;i<line.quantity;i+=1)await client.query("INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,'PURCHASE',$3)",[order.user_id,line.product_id,line.id]);}}
        await client.query("UPDATE coupon_redemptions SET status='COMMITTED' WHERE order_id=$1 AND status='RESERVED'",[order.id]);await client.query("UPDATE payments SET status='PAID',provider_payment_id=COALESCE($2,provider_payment_id),paid_at=$3,version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null,occurredAt]);await client.query("UPDATE orders SET status='PAID',paid_at=$2,version=version+1 WHERE id=$1",[order.id,occurredAt]);await recordPaymentLedger(client,pay,order.id,eventId,"Verified provider webhook");await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"order.paid",payload:{orderId:order.id,userId:order.user_id}});return "processed" as const;
      }

      if(eventType==="PAYMENT_FAILED"||eventType==="PAYMENT_CANCELLED"){if(["PENDING","AUTHORIZED"].includes(pay.status)){await releasePendingOrder(client,order,eventType);await client.query("UPDATE payments SET status=$2,provider_payment_id=COALESCE($3,provider_payment_id),version=version+1 WHERE id=$1",[pay.id,eventType==="PAYMENT_FAILED"?"FAILED":"CANCELLED",providerPaymentId||null]);await client.query("UPDATE orders SET status='CANCELLED',cancelled_at=$2,version=version+1 WHERE id=$1",[order.id,occurredAt]);await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"order.cancelled",payload:{orderId:order.id,reason:eventType}});return "processed" as const;}await writeOutbox(client,request.id,{aggregateType:"PAYMENT",aggregateId:pay.id,eventType:"payment.terminal_event_observed",payload:{paymentId:pay.id,orderId:order.id,providerEventId:eventId,eventType,previousPaymentStatus:pay.status}});return "ignored" as const;}

      if(pay.status==="REFUNDED")return "processed" as const;
      if(["PENDING","AUTHORIZED","FAILED","CANCELLED"].includes(pay.status)){if(["PENDING","AUTHORIZED"].includes(pay.status))await releasePendingOrder(client,order,"PROVIDER_REFUND_BEFORE_SUCCESS");await recordPaymentLedger(client,pay,order.id,eventId,"Payment inferred from verified provider refund");await recordRefundLedger(client,pay,order.id,eventId,"Verified provider refund before local fulfillment");await client.query("UPDATE payments SET status='REFUNDED',provider_payment_id=COALESCE($2,provider_payment_id),paid_at=COALESCE(paid_at,$3),refunded_at=$3,version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null,occurredAt]);await client.query("UPDATE orders SET status='REFUNDED',paid_at=COALESCE(paid_at,$2),refunded_at=$2,version=version+1 WHERE id=$1",[order.id,occurredAt]);await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"order.refunded",payload:{orderId:order.id,userId:order.user_id,withoutLocalFulfillment:true}});return "processed" as const;}
      if(!["PAID","REFUND_REVIEW"].includes(pay.status))return markReview("payment.refund_state_requires_reconciliation",{previousPaymentStatus:pay.status});
      const assets=await lockRefundAssets(client,order);const lateSuccessWithoutAssets=pay.status==="REFUND_REVIEW"&&Boolean(order.cancelled_at)&&assets.inventoryIds.length===0&&assets.entitlementIds.length===0;if(!lateSuccessWithoutAssets&&refundRequiresReview(assets.safety)){await recordRefundLedger(client,pay,order.id,eventId,"Verified provider refund with assets requiring reconciliation");return markReview("payment.refund_requires_reconciliation",assets.safety);}
      if(lateSuccessWithoutAssets){await recordRefundLedger(client,pay,order.id,eventId,"Verified provider refund after late success");await client.query("UPDATE payments SET status='REFUNDED',provider_payment_id=COALESCE($2,provider_payment_id),refunded_at=$3,version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null,occurredAt]);await client.query("UPDATE orders SET status='REFUNDED',refunded_at=$2,version=version+1 WHERE id=$1",[order.id,occurredAt]);await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"order.refunded",payload:{orderId:order.id,userId:order.user_id,lateSuccessReconciled:true}});return "processed" as const;}
      await client.query("SAVEPOINT refund_asset_transition");const inventoryTransition=await client.query("UPDATE inventory_units SET status='REFUNDED' WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED' RETURNING id",[assets.inventoryIds,order.user_id]);const entitlementTransition=await client.query("UPDATE draw_entitlements SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status='AVAILABLE' RETURNING id",[assets.entitlementIds]);if(inventoryTransition.rowCount!==assets.inventoryIds.length||entitlementTransition.rowCount!==assets.entitlementIds.length){await client.query("ROLLBACK TO SAVEPOINT refund_asset_transition");await client.query("RELEASE SAVEPOINT refund_asset_transition");await recordRefundLedger(client,pay,order.id,eventId,"Verified provider refund with concurrent asset transition");return markReview("payment.refund_requires_reconciliation",{...assets.safety,transitionMismatch:true});}await client.query("RELEASE SAVEPOINT refund_asset_transition");
      for(const line of assets.lines){if(isDrawCategory(line.category_snapshot)){const activeVersionId=assets.activeDrawVersionByProduct.get(line.product_id)??null;if(!shouldRelistRefundedDrawStock(line.probability_version_id,activeVersionId)){await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"draw.refund_stock_not_relisted",payload:{orderId:order.id,orderLineId:line.id,productId:line.product_id,quantity:line.quantity,refundedVersionId:line.probability_version_id,activeVersionId}});continue;}}await client.query("UPDATE product_stock SET on_hand=on_hand+$2,version=version+1 WHERE product_id=$1",[line.product_id,line.quantity]);}
      if(numberValue(order.point_total)>0){const pointLedger=await client.query("INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason) VALUES($1,'REFUND',$2,'ORDER',$3,'Paid order refunded') ON CONFLICT DO NOTHING RETURNING id",[order.user_id,order.point_total,order.id]);if(pointLedger.rowCount)await client.query("UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",[order.user_id,order.point_total]);}const coupon=await client.query<{coupon_id:string}>("UPDATE coupon_redemptions SET status='REFUNDED' WHERE order_id=$1 AND status='COMMITTED' RETURNING coupon_id",[order.id]);if(coupon.rowCount)await client.query("UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE id=$1",[coupon.rows[0]!.coupon_id]);await client.query("UPDATE payments SET status='REFUNDED',provider_payment_id=COALESCE($2,provider_payment_id),refunded_at=$3,version=version+1 WHERE id=$1",[pay.id,providerPaymentId||null,occurredAt]);await client.query("UPDATE orders SET status='REFUNDED',refunded_at=$2,version=version+1 WHERE id=$1",[order.id,occurredAt]);await recordRefundLedger(client,pay,order.id,eventId,"Verified provider refund");await writeOutbox(client,request.id,{aggregateType:"ORDER",aggregateId:order.id,eventType:"order.refunded",payload:{orderId:order.id,userId:order.user_id}});return "processed" as const;
    });return reply.code(202).send({accepted:true,outcome});
  });

  app.post("/v1/draws/:entitlementId/consume",{preHandler:context.auth.requireUser},async(request,reply)=>{
    const entitlementId=uuidInput((request.params as Record<string,unknown>).entitlementId,"entitlementId");
    const key=idempotencyKey(request.headers);
    const hash=requestHash({entitlementId});
    const result=await withTransaction(context.pool,async(client)=>{
      const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CONSUME_DRAW",key,hash});
      if(!idem.fresh)return {replay:true,statusCode:idem.statusCode,body:idem.body};
      const lookup=await client.query<{product_id:string;probability_version_id:string}>("SELECT product_id,probability_version_id FROM draw_entitlements WHERE id=$1",[entitlementId]);if(!lookup.rowCount)throw notFound("추첨권을 찾을 수 없습니다.");const lockTarget=lookup.rows[0]!;await client.query("SELECT p.id FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p,s",[lockTarget.product_id]);await client.query("SELECT id FROM draw_probability_versions WHERE id=$1 FOR UPDATE",[lockTarget.probability_version_id]);await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[`draw-capacity:${lockTarget.probability_version_id}`]);
      const entitlement=await client.query<{id:string;user_id:string;product_id:string;probability_version_id:string;status:string;version:number}>(`SELECT e.*,v.version FROM draw_entitlements e JOIN draw_probability_versions v ON v.id=e.probability_version_id WHERE e.id=$1 FOR UPDATE OF e`,[entitlementId]);
      if(!entitlement.rowCount)throw notFound("추첨권을 찾을 수 없습니다.");
      const ticket=entitlement.rows[0]!;
      if(ticket.user_id!==request.actor!.userId)throw forbidden();
      if(ticket.status==="CONSUMED"){
        const existing=await client.query<{id:string;entitlement_id:string;product_id:string;prize_product_id:string;prize_inventory_unit_id:string;probability_version:number;rarity:string;committed_at:Date}>(`SELECT r.*,e.rarity FROM draw_results r JOIN draw_pool_entries e ON e.id=r.pool_entry_id WHERE r.entitlement_id=$1`,[entitlementId]);
        const row=existing.rows[0]!;
        const body={id:row.id,entitlementId:row.entitlement_id,productId:row.product_id,prizeProductId:row.prize_product_id,prizeInventoryUnitId:row.prize_inventory_unit_id,probabilityVersion:row.probability_version,rarity:row.rarity,committedAt:iso(row.committed_at)};
        await completeIdempotency(client,idem.id,{statusCode:200,body,resourceType:"DRAW_RESULT",resourceId:row.id});
        return {replay:true,statusCode:200,body};
      }
      if(ticket.status!=="AVAILABLE")throw conflict("사용할 수 없는 추첨권입니다.");
      const entries=await client.query<{id:string;prize_product_id:string;rarity:string;weight:number;remaining_quantity:number|null}>("SELECT id,prize_product_id,rarity,weight,remaining_quantity FROM draw_pool_entries WHERE probability_version_id=$1 AND (remaining_quantity IS NULL OR remaining_quantity>0) ORDER BY id FOR UPDATE",[ticket.probability_version_id]);
      if(!entries.rowCount)throw conflict("남은 경품이 없습니다.");
      const weighted=entries.rows.map((entry)=>({entry,effective:numberValue(entry.weight)*(entry.remaining_quantity===null?1:numberValue(entry.remaining_quantity))}));
      const totalWeight=weighted.reduce((sum,item)=>sum+item.effective,0);
      if(!Number.isSafeInteger(totalWeight)||totalWeight<=0)throw conflict("추첨 확률표가 올바르지 않습니다.");
      const evidence=createDrawSelectionEvidence(totalWeight);
      const selected=weighted[weightedSelectionIndex(weighted.map((item)=>item.effective),evidence.roll)]!.entry;
      const selectionSnapshot=weighted.map((item)=>({poolEntryId:item.entry.id,effectiveWeight:item.effective}));
      if(selected.remaining_quantity!==null){
        const decremented=await client.query("UPDATE draw_pool_entries SET remaining_quantity=remaining_quantity-1 WHERE id=$1 AND remaining_quantity>0 RETURNING id",[selected.id]);
        if(!decremented.rowCount)throw conflict("경품 재고가 소진되었습니다.");
      }
      const sourceType=(await client.query<{category:string}>("SELECT category FROM catalog_products WHERE id=$1",[ticket.product_id])).rows[0]!.category==="kuji"?"KUJI":"GACHA";
      const inventory=await client.query<{id:string}>("INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,$3,$4) RETURNING id",[request.actor!.userId,selected.prize_product_id,sourceType,entitlementId]);
      const created=await client.query<{id:string;committed_at:Date}>(`INSERT INTO draw_results(
          entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
          probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,committed_at`,[
        entitlementId,request.actor!.userId,ticket.product_id,selected.id,selected.prize_product_id,inventory.rows[0]!.id,
        ticket.version,evidence.algorithm,evidence.entropyHex,evidence.entropyDigest,evidence.roll,evidence.totalWeight,JSON.stringify(selectionSnapshot),
      ]);
      await client.query("UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1",[entitlementId]);
      const body={id:created.rows[0]!.id,entitlementId,productId:ticket.product_id,prizeProductId:selected.prize_product_id,prizeInventoryUnitId:inventory.rows[0]!.id,probabilityVersion:ticket.version,rarity:selected.rarity,committedAt:iso(created.rows[0]!.committed_at)};
      await writeOutbox(client,request.id,{aggregateType:"DRAW_RESULT",aggregateId:body.id,eventType:"draw.committed",payload:{...body,userId:request.actor!.userId}});
      await completeIdempotency(client,idem.id,{statusCode:200,body,resourceType:"DRAW_RESULT",resourceId:body.id});
      return {replay:false,statusCode:200,body};
    });
    if(result.replay)reply.header("x-idempotent-replay","true");
    return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/admin/products/:productId/draw-versions",{preHandler:context.auth.requirePermission("catalog.read")},async(request)=>{const productId=slugIdInput((request.params as Record<string,unknown>).productId,"productId");const product=await context.pool.query("SELECT 1 FROM catalog_products WHERE id=$1 AND category IN ('gacha','kuji')",[productId]);if(!product.rowCount)throw notFound("가챠·쿠지 상품을 찾을 수 없습니다.");const result=await context.pool.query<DrawVersionRow>(`SELECT v.id,v.product_id,v.version,v.status,v.published_by,v.published_at,v.created_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',e.id,'prizeProductId',e.prize_product_id,'rarity',e.rarity,'weight',e.weight,
        'initialQuantity',e.initial_quantity,'remainingQuantity',e.remaining_quantity
      ) ORDER BY e.created_at,e.id) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) AS entries
    FROM draw_probability_versions v LEFT JOIN draw_pool_entries e ON e.probability_version_id=v.id
    WHERE v.product_id=$1 GROUP BY v.id ORDER BY v.version DESC`,[productId]);return{items:result.rows.map((row)=>{const entries=row.entries.map((entry)=>({...entry,weight:numberValue(entry.weight),initialQuantity:entry.initialQuantity===null?null:numberValue(entry.initialQuantity),remainingQuantity:entry.remainingQuantity===null?null:numberValue(entry.remainingQuantity)}));const totalEffectiveWeight=entries.reduce((sum,entry)=>sum+entry.weight*(entry.remainingQuantity===null?1:entry.remainingQuantity),0);return{id:row.id,productId:row.product_id,version:row.version,status:row.status,publishedBy:row.published_by,publishedAt:nullableIso(row.published_at),createdAt:iso(row.created_at),totalEffectiveWeight,entries};})};});

  app.post("/v1/admin/products/:productId/draw-versions",{preHandler:context.auth.requirePermission("catalog.write")},async(request,reply)=>{const productId=slugIdInput((request.params as Record<string,unknown>).productId,"productId");const body=objectInput(request.body);if(!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>200)throw badRequest("경품 구성을 확인해 주세요.");const entries=body.entries.map((raw)=>{const item=objectInput(raw);return{prizeProductId:slugIdInput(item.prizeProductId,"prizeProductId"),rarity:stringInput(item,"rarity",{max:40})!,weight:integerInput(item,"weight",{min:1,max:1_000_000})!,quantity:item.quantity===null||item.quantity===undefined?null:integerInput(item,"quantity",{min:1,max:10_000})!};});
    const mutation=await adminIdempotentMutation(context,request,{target:{type:"PRODUCT_DRAW_VERSION",productId},work:async(client)=>{const product=await client.query<{category:string}>("SELECT category FROM catalog_products WHERE id=$1 FOR UPDATE",[productId]);if(!product.rowCount)throw notFound();if(!["gacha","kuji"].includes(product.rows[0]!.category))throw badRequest("가챠·쿠지 상품만 확률표를 가질 수 있습니다.");const next=await client.query<{version:number}>("SELECT COALESCE(max(version),0)+1 AS version FROM draw_probability_versions WHERE product_id=$1",[productId]);const created=await client.query<{id:string;version:number;created_at:Date}>("INSERT INTO draw_probability_versions(product_id,version) VALUES($1,$2) RETURNING id,version,created_at",[productId,next.rows[0]!.version]);const savedEntries=[];for(const entry of entries){const saved=await client.query<{id:string}>("INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,rarity,weight,initial_quantity,remaining_quantity) VALUES($1,$2,$3,$4,$5,$5) RETURNING id",[created.rows[0]!.id,entry.prizeProductId,entry.rarity,entry.weight,entry.quantity]);savedEntries.push({id:saved.rows[0]!.id,prizeProductId:entry.prizeProductId,rarity:entry.rarity,weight:entry.weight,initialQuantity:entry.quantity,remainingQuantity:entry.quantity});}await writeAdminAudit(client,request,request.actor!,{action:"DRAW_VERSION_CREATED",targetType:"DRAW_PROBABILITY_VERSION",targetId:created.rows[0]!.id,after:{productId,version:created.rows[0]!.version,entries:entries.length}});const totalEffectiveWeight=savedEntries.reduce((sum,entry)=>sum+entry.weight*(entry.remainingQuantity===null?1:entry.remainingQuantity),0);const response={id:created.rows[0]!.id,productId,version:created.rows[0]!.version,status:"DRAFT" as const,publishedBy:null,publishedAt:null,createdAt:iso(created.rows[0]!.created_at),totalEffectiveWeight,entries:savedEntries};return{statusCode:201,body:response,resourceType:"DRAW_PROBABILITY_VERSION",resourceId:created.rows[0]!.id};}});return sendAdminMutation(reply,mutation);});

  app.post("/v1/admin/products/:productId/draw-versions/:versionId/publish",{preHandler:context.auth.requirePermission("catalog.write")},async(request,reply)=>{const params=request.params as Record<string,unknown>;const productId=slugIdInput(params.productId,"productId");const versionId=uuidInput(params.versionId,"versionId");const body=objectInput(request.body);const reason=stringInput(body,"reason",{max:1000})!;const mutation=await adminIdempotentMutation(context,request,{target:{type:"DRAW_PROBABILITY_VERSION",productId,versionId},bodyReason:reason,work:async(client)=>{const stock=await client.query<{on_hand:number}>("SELECT s.on_hand FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1 AND p.category IN ('gacha','kuji') FOR UPDATE OF p,s",[productId]);if(!stock.rowCount)throw notFound("가챠·쿠지 상품을 찾을 수 없습니다.");const version=await client.query<{id:string;status:string;version:number}>("SELECT id,status,version FROM draw_probability_versions WHERE id=$1 AND product_id=$2 FOR UPDATE",[versionId,productId]);if(!version.rowCount)throw notFound();if(version.rows[0]!.status!=="DRAFT")throw conflict("초안 확률표만 공개할 수 있습니다.");const count=await client.query<{count:string;drawable_count:string;effective_weight:string}>(`SELECT count(*) AS count,
        count(*) FILTER (WHERE remaining_quantity IS NULL OR remaining_quantity > 0) AS drawable_count,
        COALESCE(sum(weight::bigint * COALESCE(remaining_quantity::bigint,1)),0) AS effective_weight
        FROM draw_pool_entries WHERE probability_version_id=$1`,[versionId]);const pool=count.rows[0]!;if(Number(pool.count)<1)throw conflict("경품 구성이 비어 있습니다.");if(Number(pool.drawable_count)!==Number(pool.count))throw conflict("수량이 0인 경품은 공개할 수 없습니다.");const effectiveWeight=Number(pool.effective_weight);if(!Number.isSafeInteger(effectiveWeight)||effectiveWeight<=0)throw conflict("경품 가중치 합계를 확인해 주세요.");await assertDrawCapacity(client,{probabilityVersionId:versionId,productId,onHand:numberValue(stock.rows[0]!.on_hand)});await client.query("UPDATE draw_probability_versions SET status='RETIRED' WHERE product_id=$1 AND status='ACTIVE'",[productId]);await client.query("UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",[versionId,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:"DRAW_VERSION_PUBLISHED",targetType:"DRAW_PROBABILITY_VERSION",targetId:versionId,reason,after:{productId,version:version.rows[0]!.version}});return{statusCode:200,body:{id:versionId,productId,version:version.rows[0]!.version,status:"ACTIVE" as const},resourceType:"DRAW_PROBABILITY_VERSION",resourceId:versionId};}});return sendAdminMutation(reply,mutation);});
}
