import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker, {handlePgReviewService} from '../worker/index.js';
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
test('only included-product review series are listed and orderable',async()=>{
 const result=await handlePgReviewService(request('/products'),{},async()=>json({items:[{id:'stg-death-note-rich',purchasable:true,metadata:{}},{id:'other',purchasable:true}]}));
 assert.equal((await result.json()).items.length,1);
 const bad=await handlePgReviewService(request('/orders',{items:[{productId:'production-product',quantity:1,expectedDrawVersion:1}],pointAmount:0},{cookie:'__Secure-dabboba-pg-review='+token}),{},()=>{throw new Error('no upstream');});assert.equal(bad.status,400);
});
test('tokens are forwarded from cookie only; logout clears cookie',async()=>{
 let auth;await handlePgReviewService(request('/me',undefined,{cookie:'__Secure-dabboba-pg-review='+token,authorization:'Bearer attacker'}),{},async(_url,opts)=>{auth=opts.headers.authorization;return json({actor:{role:'USER'}});});assert.equal(auth,'Bearer '+token);
 const loggedOut=await handlePgReviewService(request('/logout',{}),{},()=>{throw new Error('no upstream');});assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('set-cookie'),/Max-Age=0/);
});
test('review static app permits NICE only within isolated payment protections',async()=>{
 const response=await handlePgReviewService(new Request('https://dabboba.net/review/'),{ASSETS:{fetch:async()=>new Response('app')}});
 assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 const csp=response.headers.get('content-security-policy');
 const directives=new Map(csp.split(';').map(d=>d.trim().split(/\s+/)).map(([name,...sources])=>[name,sources]));
 assert.deepEqual(directives.get('script-src'),["'self'",'https://cdn.portone.io']);
 assert.deepEqual(directives.get('connect-src'),["'self'",'https://checkout-service.prod.iamport.co','https://coretelemetry.prod.iamport.co','https://tx-gateway-service.prod.iamport.co','https://payment-bridge.prod.iamport.co','https://service.iamport.kr','https://*.nicepay.co.kr']);
 assert.deepEqual(directives.get('frame-src'),['https://checkout-service.prod.iamport.co','https://payment-bridge.prod.iamport.co','https://service.iamport.kr','https://*.nicepay.co.kr']);
 assert.deepEqual(directives.get('form-action'),["'self'",'https://*.nicepay.co.kr','https://service.iamport.kr']);
 assert.deepEqual(directives.get('style-src'),["'self'"]);
 assert.deepEqual(directives.get('base-uri'),["'none'"]);
 assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);
 assert.doesNotMatch(csp,/easypay|inicis|kcp|unsafe-inline|unsafe-eval/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal((await handlePgReviewService(new Request('https://unrelated.pages.dev/review/'),{})).status,404);
});
test('Payment CSP allowance never leaks into the storefront or policy pages',async()=>{
 for(const path of ['/','/terms','/privacy','/support','/account-deletion']){
  const response=await worker.fetch(new Request('https://dabboba.net'+path),{ASSETS:{fetch:async()=>new Response('page',{headers:{'content-type':'text/html'}})}});
  assert.equal(response.status,200);
  const csp=response.headers.get('content-security-policy');
  assert.ok(csp);
  assert.doesNotMatch(csp,/tosspayments|portone|iamport|inicis|kcp/);
  assert.notEqual(response.headers.get('referrer-policy'),'no-referrer');
 }
 assert.equal(await handlePgReviewService(new Request('https://dabboba.net/reviewer/'),{}),null);
});
test('upstream redirects are not followed with customer credentials',async()=>{
 const response=await handlePgReviewService(request('/me',undefined,{cookie:'__Secure-dabboba-pg-review='+token}),{},async(_url,opts)=>{
  assert.equal(opts.redirect,'manual'); return new Response(null,{status:302,headers:{location:'https://unrelated.test'}});
 });
 assert.equal(response.status,502);
});
test('login forwards only a freshly signed Cloudflare visitor IP for per-reviewer limits',async()=>{
 const secret='review-proxy-secret-0123456789abcdefghij';
 const login=(env,extra)=>{let sent;return handlePgReviewService(request('/login',{email:'pg',password:'fixture'},{'cf-connecting-ip':'203.0.113.7','x-dabboba-review-client-ip':'198.51.100.1',...extra}),env,async(_url,opts)=>{sent=opts.headers;return json({error:{message:'denied'}},401);}).then(()=>sent);};
 const signed=await login({PG_REVIEW_PROXY_SECRET:secret});
 assert.equal(signed['x-dabboba-review-client-ip'],'203.0.113.7','the client-supplied header is never trusted');
 const time=signed['x-dabboba-review-client-ip-time'];
 assert.ok(Math.abs(Number(time)-Date.now()/1000)<5);
 assert.equal(signed['x-dabboba-review-client-ip-signature'],createHmac('sha256',secret).update(`dabboba-review-client-ip:v1\n${time}\n203.0.113.7`).digest('hex'));
 for (const env of [{},{PG_REVIEW_PROXY_SECRET:'too-short'}]) assert.equal((await login(env))['x-dabboba-review-client-ip'],undefined);
 let meHeaders;await handlePgReviewService(request('/me',undefined,{cookie:'__Secure-dabboba-pg-review='+token,'cf-connecting-ip':'203.0.113.7'}),{PG_REVIEW_PROXY_SECRET:secret},async(_url,opts)=>{meHeaders=opts.headers;return json({actor:{role:'USER'}});});
 assert.equal(meHeaders['x-dabboba-review-client-ip'],undefined,'only the login request carries the signed IP');
});

test('NICE-only proxy preserves historical payment queries and refuses other new providers',async()=>{
 const paymentId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';const cookie='__Secure-dabboba-pg-review='+token;
 for(const [family,upstream] of [['payments','/v1/payments/'],['toss-payments','/v1/review/toss-payments/']]){
  let target;const r=await handlePgReviewService(request(`/${family}/${paymentId}/confirm`,{},{cookie}),{},async url=>{target=url;return json({status:'PENDING'});});
  assert.equal(r.status,200);assert.equal(target,`https://lyzcyrdiazorjaqlgblr.supabase.co/functions/v1/dabboba-api${upstream}${paymentId}/confirm`);
 }
 const body={items:[{productId:'stg-death-note-rich',quantity:1,expectedDrawVersion:1}],pointAmount:0};
 const legacy=await handlePgReviewService(request('/orders',{...body,reviewPaymentProvider:'PORTONE_V2_KICC',cardPg:'KICC'},{cookie}),{},()=>{throw new Error('no new EasyPay order');});
 assert.equal(legacy.status,403,'preserve an unknown historical order intent rather than declaring no order exists');
 for(const selection of [{reviewPaymentProvider:'PORTONE_V2_NICE',cardPg:'NICE'}]) {
  let sent;const r=await handlePgReviewService(request('/orders',{...body,...selection},{cookie}),{},async(_url,init)=>{sent=JSON.parse(init.body);return json({id:paymentId});});
  assert.equal(r.status,200);assert.equal(sent.reviewPaymentProvider,selection.reviewPaymentProvider);
 }
 for(const selection of [{reviewPaymentProvider:'PORTONE_V2_NICE',cardPg:'INICIS'},{reviewPaymentProvider:'TOSSPAYMENTS_DIRECT',cardPg:'NICE'},{reviewPaymentProvider:'OTHER'}]){
  const r=await handlePgReviewService(request('/orders',{...body,...selection},{cookie}),{},()=>{throw new Error('no upstream');});assert.equal(r.status,400);
 }
});
