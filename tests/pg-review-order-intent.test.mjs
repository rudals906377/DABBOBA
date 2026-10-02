import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOrderIntent} from '../public/review/order-intent.js';
const body = {items:[{productId:'stg-death-note-rich',quantity:1,expectedDrawVersion:7}],pointAmount:0};
const order = {id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',paymentId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',total:7000};
function storage() { const values = new Map(); return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}; }
test('lost order response and reload replay the original key and fixed odds body',async()=>{
 const store=storage(); const first=reviewOrderIntent(store,()=> 'first-intent',()=>100);
 first.prepare(body); let committed; let count=0;
 const server=async (payload,key)=>{if(!committed){committed={payload,key};count++;throw new Error('response lost');}assert.deepEqual(payload,committed.payload);assert.equal(key,committed.key);return order;};
 await assert.rejects(first.resolve(server),/response lost/);
 const reloaded=reviewOrderIntent(store,()=> 'must-not-be-used',()=>200);
 assert.equal(reloaded.prepare({...body,items:[{...body.items[0],expectedDrawVersion:8}]}).body.items[0].expectedDrawVersion,7);
 assert.deepEqual(await reloaded.resolve(server),order); assert.equal(count,1);
 assert.deepEqual(await reloaded.resolve(()=>{throw new Error('no second POST');}),order);
});
test('different product or quantity cannot replace an unresolved purchase',()=>{
 const intent=reviewOrderIntent(storage(),()=> 'test');intent.prepare(body);
 assert.throws(()=>intent.prepare({...body,items:[{...body.items[0],quantity:2}]}),/이전 주문/);
 assert.throws(()=>intent.prepare({...body,items:[{...body.items[0],productId:'other'}]}),/이전 주문/);
});
test('persistence failure prevents POST and expired unknown intents stay recoverable',async()=>{
 const unavailable={getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');}};
 assert.throws(()=>reviewOrderIntent(unavailable,()=> 'test').prepare(body),/storage unavailable/);
 const store=storage();reviewOrderIntent(store,()=> 'test',()=>0).prepare(body);
 const expired=reviewOrderIntent(store,()=> 'new',()=>86400000);
 await assert.rejects(expired.resolve(()=>{throw new Error('must not POST');}),/고객센터/);
 assert.ok(expired.read());
});
