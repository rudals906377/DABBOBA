import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewTossConnection,tossReturn,tossPaymentRequest} from '../public/review/payment-channel.js';
const connection={provider:'TOSSPAYMENTS_DIRECT',environment:'TEST',clientKey:'test_ck_synthetic_123456789'};
test('review allows only direct Toss TEST and never falls back to old PGs',()=>{
 assert.deepEqual(reviewTossConnection({tossPayment:connection}),connection);
 for(const config of [{}, {cardPaymentOptions:[{provider:'PORTONE_V2_INICIS'}]}, {tossPayment:{...connection,environment:'LIVE'}}, {tossPayment:{...connection,clientKey:'live_ck_no'}}]) assert.equal(reviewTossConnection(config),null);
});
test('Toss callbacks reject ambiguous values and never claim approval themselves',()=>{
 const orderId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const base='https://dabboba.net/review/?tossReturn=success&paymentKey=key_123456&orderId='+orderId+'&amount=7000';
 assert.deepEqual(tossReturn(base),{type:'success',paymentKey:'key_123456',orderId,amount:7000});
 assert.throws(()=>tossReturn(base+'&amount=1'));
 assert.throws(()=>tossReturn(base.replace('7000','-1')));
 assert.deepEqual(tossReturn('https://dabboba.net/review/?tossReturn=fail'),{type:'fail'});
});
test('Toss requests use the server amount and payment id, not mutable product prices',()=>{
 const form={fullName:{value:'시험'},customerEmail:{value:'review@example.test'},phoneNumber:{value:'010-0000-0000'}};
 const r=tossPaymentRequest({paymentId:'payment_12345',total:7000},{id:'stg-death-note-rich',name:'상품',price:1},form,'https://dabboba.net');
 assert.deepEqual(r.amount,{currency:'KRW',value:7000}); assert.equal(r.orderId,'payment_12345');
 assert.match(r.successUrl,/^https:\/\/dabboba.net\/review\/\?tossReturn=success/);
 assert.equal(r.method,'CARD'); assert.doesNotMatch(JSON.stringify(r),/PortOne|channelKey/);
});

test('shared review lists NICE and direct Toss independently, rejects LIVE and never substitutes a provider',async()=>{
 const {reviewPaymentOptions,nicePaymentRequest,reviewPaymentActionPath,assertReviewPaymentOrder}=await import('../public/review/payment-channel.js');
 const nice={provider:'PORTONE_V2_NICE',pgProvider:'NICE_V2',channelEnvironment:'TEST',storeId:'store-synthetic',merchantId:'merchant-synthetic',channelKey:'channel-key-nice-synthetic'};
 const config={cardPaymentOptions:[nice],tossPayment:connection};
 assert.deepEqual(reviewPaymentOptions(config).map(p=>p.provider),['PORTONE_V2_NICE','TOSSPAYMENTS_DIRECT']);
 assert.deepEqual(reviewPaymentOptions({cardPaymentOptions:[{...nice,channelEnvironment:'LIVE'}]}),[]);
 assert.deepEqual(reviewPaymentOptions({tossPayment:connection}).map(p=>p.provider),['TOSSPAYMENTS_DIRECT']);
 const order={id:'order',paymentId:'payment',paymentProvider:'PORTONE_V2_NICE',cardPayment:nice,total:7000};
 assert.doesNotThrow(()=>assertReviewPaymentOrder(order,'PORTONE_V2_NICE',config));
 assert.throws(()=>assertReviewPaymentOrder(order,'TOSSPAYMENTS_DIRECT',config));
 assert.throws(()=>assertReviewPaymentOrder({...order,cardPayment:{...nice,channelKey:'channel-key-other'}},'PORTONE_V2_NICE',config));
 const form={fullName:{value:'시험'},customerEmail:{value:'review@example.test'},phoneNumber:{value:'010-0000-0000'}};
 const request=nicePaymentRequest(order,{id:'chosen',name:'선택 상품',price:1},form,'https://dabboba.net',config);
 assert.equal(request.totalAmount,7000);assert.equal(request.channelKey,nice.channelKey);assert.equal(request.paymentId,'payment');assert.equal(request.payMethod,'CARD');
 assert.equal(reviewPaymentActionPath('TOSSPAYMENTS_DIRECT','payment','confirm'),'/toss-payments/payment/confirm');
 assert.equal(reviewPaymentActionPath('PORTONE_V2_NICE','payment','confirm'),'/payments/payment/confirm');
 assert.throws(()=>reviewPaymentActionPath('PORTONE_V2_INICIS','payment','confirm'));
});

test('shared callbacks preserve provider identity and reject mixed or ambiguous returns',async()=>{
 const {reviewReturn}=await import('../public/review/payment-channel.js');
 const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 assert.deepEqual(reviewReturn(`https://dabboba.net/review/?niceReturn=1&paymentId=${id}`),{provider:'PORTONE_V2_NICE',type:'return',paymentId:id});
 assert.throws(()=>reviewReturn('https://dabboba.net/review/?niceReturn=1&tossReturn=fail'));
 assert.throws(()=>reviewReturn('https://dabboba.net/review/?niceReturn=1&niceReturn=1'));
 assert.throws(()=>reviewReturn('https://dabboba.net/review/?niceReturn=1&paymentId=wrong'));
 assert.equal(reviewReturn('https://dabboba.net/review/?tossReturn=fail').provider,'TOSSPAYMENTS_DIRECT');
});
