const STORE = 'store-08e382ae-230f-46e8-a1d3-30e28ae31d3a';
const ALLOWED = {
  INICIS: {provider:'PORTONE_V2_INICIS',pgProvider:'INICIS_V2',channelKey:'channel-key-f21d589c-94b2-4801-921a-f6f926e6dccc'},
  KCP: {provider:'PORTONE_V2_KCP',pgProvider:'KCP_V2',channelKey:'channel-key-bc0b3dde-475a-490c-85df-c4f4ebdb2b3c'},
};
export const paymentLabels = {INICIS:'KG이니시스',KCP:'NHN KCP'};
export function checkedChannel(binding, cardPg) {
  const expected=ALLOWED[cardPg];
  if (!expected || !binding || binding.storeId!==STORE || binding.channelEnvironment!=='TEST'
    || Object.entries(expected).some(([key,value])=>binding[key]!==value)) {
    throw new Error('선택한 TEST 결제 채널을 확인하지 못했어요. 새 결제는 진행하지 않습니다.');
  }
  return binding;
}
export function reviewChannels(config) {
  // Compatibility for the already verified single-INICIS staging API only.
  if (config.cardPaymentOptions===undefined) return [{...ALLOWED.INICIS,storeId:STORE,channelEnvironment:'TEST',cardPg:'INICIS'}];
  if (!Array.isArray(config.cardPaymentOptions)) return [];
  return config.cardPaymentOptions.flatMap(binding=>{
    const cardPg=Object.keys(ALLOWED).find(key=>ALLOWED[key].provider===binding.provider);
    try { return [{...checkedChannel(binding,cardPg),cardPg}]; } catch {return [];}
  });
}
export function orderChannel(order, cardPg) {
  if (!order.cardPayment && cardPg==='INICIS') return checkedChannel({...ALLOWED.INICIS,storeId:STORE,channelEnvironment:'TEST'},cardPg);
  return checkedChannel(order.cardPayment,cardPg);
}
