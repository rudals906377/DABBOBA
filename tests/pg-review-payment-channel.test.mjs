import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewChannels,orderChannel} from '../public/review/payment-channel.js';
const inicis={provider:'PORTONE_V2_INICIS',pgProvider:'INICIS_V2',storeId:'store-08e382ae-230f-46e8-a1d3-30e28ae31d3a',channelKey:'channel-key-f21d589c-94b2-4801-921a-f6f926e6dccc',channelEnvironment:'TEST'};
const kcp={...inicis,provider:'PORTONE_V2_KCP',pgProvider:'KCP_V2',channelKey:'channel-key-bc0b3dde-475a-490c-85df-c4f4ebdb2b3c'};
test('review lists only exact configured TEST channels and honors explicit disable',()=>{
 assert.deepEqual(reviewChannels({cardPaymentOptions:[inicis,kcp]}).map(c=>c.cardPg),['INICIS','KCP']);
 assert.deepEqual(reviewChannels({cardPaymentOptions:[]}),[]);
 assert.deepEqual(reviewChannels({cardPaymentOptions:[{...kcp,channelEnvironment:'LIVE'},{...kcp,channelKey:'foreign'}]}),[]);
});
test('order-bound KCP cannot use INICIS, a foreign channel, or legacy fallback',()=>{
 assert.deepEqual(orderChannel({cardPayment:kcp},'KCP'),kcp);
 assert.throws(()=>orderChannel({cardPayment:inicis},'KCP'),/채널/);
 assert.throws(()=>orderChannel({cardPayment:{...kcp,storeId:'foreign'}},'KCP'),/채널/);
 assert.throws(()=>orderChannel({},'KCP'),/채널/);
 assert.equal(orderChannel({},'INICIS').pgProvider,'INICIS_V2');
});
