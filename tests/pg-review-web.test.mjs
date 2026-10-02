import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePgReviewService} from '../worker/index.js';
const token = 'a'.repeat(43);
function request(route, body, extra={}) {return new Request('https://dabboba.net/review/api'+route,{method:body===undefined?'GET':'POST',headers:{origin:'https://dabboba.net','content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const json = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('review proxy uses only fixed TEST config endpoint', async()=>{
 let called;const result=await handlePgReviewService(request('/config'),{},async url=>{called=url;return json({commerceMode:'LIVE'});});
 assert.equal(called,'https://lyzcyrdiazorjaqlgblr.supabase.co/functions/v1/dabboba-api/v1/public/config');assert.equal(result.status,200);
});
test('login places session only in Secure HttpOnly cookie',async()=>{
 const result=await handlePgReviewService(request('/login',{email:'pg',password:'fixture'}),{},async()=>json({token,expiresAt:new Date(Date.now()+60000).toISOString()},201));
 assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.ok(!(await result.text()).includes(token));
});
test('cross site POST and unauthorized orders never reach upstream',async()=>{
 const deny=()=>{throw new Error('upstream must not be reached');};
 assert.equal((await handlePgReviewService(request('/login',{email:'pg'},{origin:'https://evil.test'}),{},deny)).status,403);
 assert.equal((await handlePgReviewService(request('/orders',{}),{},deny)).status,401);
 assert.equal((await handlePgReviewService(request('/admin/users'),{},deny)).status,404);
 assert.equal((await handlePgReviewService(request('/login',null),{},deny)).status,400);
});
test('only exact review products are listed and orderable',async()=>{
 const result=await handlePgReviewService(request('/products'),{},async()=>json({items:[{id:'stg-death-note-rich',purchasable:true},{id:'other',purchasable:true}]}));
 assert.equal((await result.json()).items.length,1);
 const bad=await handlePgReviewService(request('/orders',{items:[{productId:'production-product',quantity:1}],pointAmount:0},{cookie:'__Secure-dabboba-pg-review='+token}),{},()=>{throw new Error('no upstream');});assert.equal(bad.status,400);
});
test('tokens are forwarded from cookie only; logout clears cookie',async()=>{
 let auth;await handlePgReviewService(request('/me',undefined,{cookie:'__Secure-dabboba-pg-review='+token,authorization:'Bearer attacker'}),{},async(_url,opts)=>{auth=opts.headers.authorization;return json({actor:{role:'USER'}});});assert.equal(auth,'Bearer '+token);
 const loggedOut=await handlePgReviewService(request('/logout',{}),{},()=>{throw new Error('no upstream');});assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('set-cookie'),/Max-Age=0/);
});
test('review static app is noindex with isolated payment CSP',async()=>{
 const response=await handlePgReviewService(new Request('https://dabboba.net/review/'),{ASSETS:{fetch:async()=>new Response('app')}});
 assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(response.headers.get('content-security-policy'),/https:\/\/cdn.portone.io/);
 assert.equal((await handlePgReviewService(new Request('https://unrelated.pages.dev/review/'),{})).status,404);
});
test('upstream redirects are not followed with customer credentials',async()=>{
 const response=await handlePgReviewService(request('/me',undefined,{cookie:'__Secure-dabboba-pg-review='+token}),{},async(_url,opts)=>{
  assert.equal(opts.redirect,'manual'); return new Response(null,{status:302,headers:{location:'https://unrelated.test'}});
 });
 assert.equal(response.status,502);
});
