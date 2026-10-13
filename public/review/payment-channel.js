export function reviewTossConnection(config) {
  const connection = config?.tossPayment;
  if (connection?.provider !== 'TOSSPAYMENTS_DIRECT' || connection.environment !== 'TEST'
    || !/^test_ck_[A-Za-z0-9_-]{10,200}$/.test(connection.clientKey || '')) return null;
  return { provider: 'TOSSPAYMENTS_DIRECT', environment: 'TEST', clientKey: connection.clientKey };
}
// Capture then erase callback query parameters before any API read or page navigation.
export function tossReturn(url) {
  const params = new URL(url).searchParams;
  if (!params.has('tossReturn')) return null;
  if (params.getAll('tossReturn').length !== 1) throw new Error('결제 복귀 정보를 확인해 주세요.');
  if (params.get('tossReturn') === 'fail') return { type: 'fail' };
  const paymentKey = params.get('paymentKey'), orderId = params.get('orderId'), amount = params.get('amount');
  if (params.get('tossReturn') !== 'success' || ['paymentKey','orderId','amount'].some(key=>params.getAll(key).length !== 1)
    || !/^[A-Za-z0-9_-]{6,200}$/.test(paymentKey || '')
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(orderId || '')
    || !/^[1-9][0-9]{0,9}$/.test(amount || '') || !Number.isSafeInteger(Number(amount))) {
    throw new Error('결제 복귀 정보를 확인해 주세요.');
  }
  return { type: 'success', paymentKey, orderId, amount: Number(amount) };
}
export function tossPaymentRequest(order, product, form, origin) {
  if (!order?.paymentId || !Number.isSafeInteger(order.total) || order.total < 1) throw new Error('서버 주문 금액을 확인하지 못했어요.');
  const base = origin + '/review/', suffix = '#checkout/' + encodeURIComponent(product.id);
  return { method: 'CARD', amount: { currency: 'KRW', value: order.total }, orderId: order.paymentId,
    orderName: product.name.slice(0,100), successUrl: base + '?tossReturn=success' + suffix,
    failUrl: base + '?tossReturn=fail' + suffix, customerName: form.fullName.value.trim(),
    customerEmail: form.customerEmail.value.trim(), customerMobilePhone: form.phoneNumber.value.replace(/[ -]/g,'') };
}

export function reviewPortOneConnection(config, provider) {
  const pg = {PORTONE_V2_NICE:'NICE_V2',PORTONE_V2_KICC:'KICC_V2'}[provider];
  if (!pg) return null;
  const candidates = (config?.cardPaymentOptions || []).filter(c => c.provider === provider);
  if (candidates.length !== 1) return null;
  const c = candidates[0];
  if (c.pgProvider !== pg || c.channelEnvironment !== 'TEST'
    || !/^store-[A-Za-z0-9-]{1,160}$/.test(c.storeId || '')
    || !/^channel-key-[A-Za-z0-9-]{1,160}$/.test(c.channelKey || '')
    || typeof c.merchantId !== 'string' || !c.merchantId || c.merchantId.length > 200) return null;
  return {provider:c.provider,pgProvider:c.pgProvider,channelEnvironment:c.channelEnvironment,
    storeId:c.storeId,merchantId:c.merchantId,channelKey:c.channelKey};
}
export function reviewNiceConnection(config) { return reviewPortOneConnection(config,'PORTONE_V2_NICE'); }
export function reviewPaymentOptions(config) {
  return [{provider:'PORTONE_V2_KICC',label:'포트원 이지페이'},{provider:'PORTONE_V2_NICE',label:'포트원 나이스페이'}]
    .map(option => {const channel=reviewPortOneConnection(config,option.provider); return channel ? {...channel,label:option.label} : null;}).filter(Boolean);
}
export function assertReviewPaymentOrder(order, provider, config, checkConnection = true) {
  const pg={PORTONE_V2_NICE:'NICE_V2',PORTONE_V2_KICC:'KICC_V2'}[provider];
  if (!pg || order?.paymentProvider !== provider) throw new Error('선택한 결제사와 주문 정보가 달라요. 이전 주문부터 확인해 주세요.');
  const bound = order.cardPayment, current = checkConnection ? reviewPortOneConnection(config,provider) : bound;
  if (!bound || bound.provider !== provider || bound.pgProvider !== pg || bound.channelEnvironment !== 'TEST'
    || !current || ['provider','pgProvider','channelEnvironment','storeId','merchantId','channelKey'].some(key => current[key] !== bound[key])) throw new Error('주문의 결제 채널을 확인하지 못했어요.');
}
export function reviewPaymentActionPath(provider, paymentId, action) {
  if (!['PORTONE_V2_NICE','PORTONE_V2_KICC'].includes(provider) || !['attempt','confirm','abandon'].includes(action)) throw new Error('주문 결제사를 확인해 주세요.');
  return `/payments/${encodeURIComponent(paymentId)}/${action}`;
}
export function portOnePaymentRequest(order, product, form, origin, config, provider) {
  assertReviewPaymentOrder(order,provider,config);
  if (!Number.isSafeInteger(order.total) || order.total < 1) throw new Error('서버 주문 금액을 확인하지 못했어요.');
  const kicc=provider==='PORTONE_V2_KICC';
  // UTF-8 bounds are conservative for KICC's EUC-KR limits; never truncate buyer identity.
  const fullName=form.fullName.value.trim(), email=form.customerEmail.value.trim(), phone=form.phoneNumber.value.replace(/[ -]/g,'');
  if (new TextEncoder().encode(fullName).length > (kicc?20:30) || !/^[0-9]{9,11}$/.test(phone) || (kicc && email.length>50)) throw new Error('결제자 이름·연락처·이메일 길이를 확인해 주세요.');
  let orderName='';
  for (const char of product.name.replace(/[%&|$\-+=\[\]]/g,' ')) {
    if (new TextEncoder().encode(orderName+char).length > (kicc?50:40)) break;
    orderName += char;
  }
  return {storeId:order.cardPayment.storeId,channelKey:order.cardPayment.channelKey,paymentId:order.paymentId,
    orderName:orderName.trim() || '다뽀바 상품',totalAmount:order.total,currency:'CURRENCY_KRW',payMethod:'CARD',
    redirectUrl:origin+'/review/?'+(kicc?'kiccReturn':'niceReturn')+'=1#checkout/'+encodeURIComponent(product.id),
    customer:{fullName,email,phoneNumber:phone}};
}
export function nicePaymentRequest(order, product, form, origin, config) { return portOnePaymentRequest(order,product,form,origin,config,'PORTONE_V2_NICE'); }
export function reviewReturn(url) {
  const params=new URL(url).searchParams;
  const markers=['niceReturn','kiccReturn','tossReturn'].filter(key=>params.has(key));
  if(markers.length>1)throw new Error('서로 다른 결제사의 복귀 정보가 섞여 있어요.');
  const key=markers[0];
  if (key==='niceReturn' || key==='kiccReturn') {
    if (params.getAll(key).length !== 1 || params.get(key) !== '1'
      || (params.has('paymentId') && (params.getAll('paymentId').length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(params.get('paymentId'))))) throw new Error('결제 복귀 정보를 확인해 주세요.');
    return {provider:key==='kiccReturn'?'PORTONE_V2_KICC':'PORTONE_V2_NICE',type:'return',paymentId:params.get('paymentId') || null};
  }
  const toss=tossReturn(url);
  return toss ? {...toss,provider:'TOSSPAYMENTS_DIRECT'} : null;
}
