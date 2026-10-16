import test from 'node:test';
import assert from 'node:assert/strict';
import type {ApiConfig} from '@dabboba/config';
import {selectReviewPaymentRail} from './review-payment-selection.js';
const config={environmentTier:'STAGING',paymentProvider:'PORTONE_V2_NICE',paymentWebhookSecret:'synthetic',
 portOne:{merchantId:'merchant-synthetic',storeId:'store-synthetic',channelKey:'channel-key-nice',channelEnvironment:'TEST'},
 tossPayments:{environment:'TEST'}} as ApiConfig;
test('shared review binds each explicit provider without replacing the NICE default',()=>{
 assert.equal(selectReviewPaymentRail(config,'PORTONE_V2_NICE').cardChannel?.pgProvider,'NICE_V2');
 assert.equal(selectReviewPaymentRail(config,'TOSSPAYMENTS_DIRECT').cardChannel,null);
 assert.equal(config.paymentProvider,'PORTONE_V2_NICE');
});
test('missing provider credentials, LIVE rails and production selection fail closed',()=>{
 assert.throws(()=>selectReviewPaymentRail({...config,tossPayments:null},'TOSSPAYMENTS_DIRECT'));
 assert.throws(()=>selectReviewPaymentRail({...config,portOne:{...config.portOne!,channelEnvironment:'LIVE'}},'PORTONE_V2_NICE'));
 for(const provider of ['PORTONE_V2_NICE','TOSSPAYMENTS_DIRECT'] as const) assert.throws(()=>selectReviewPaymentRail({...config,environmentTier:'PRODUCTION'},provider));
 assert.throws(()=>selectReviewPaymentRail({...config,paymentProvider:'TOSSPAYMENTS_DIRECT',portOne:null},'PORTONE_V2_NICE'));
});
