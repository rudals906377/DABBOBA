import { reviewOrderIntent } from './order-intent.js';
import { reviewPaymentOptions, reviewReturn, tossPaymentRequest, portOnePaymentRequest, reviewPaymentActionPath, assertReviewPaymentOrder } from './payment-channel.js';
let callback, callbackError;
try { callback = reviewReturn(location.href); } catch (error) { callbackError = error.message; }
if (['tossReturn','niceReturn','kiccReturn'].some(key=>new URL(location.href).searchParams.has(key))) history.replaceState(null, '', location.pathname + location.hash);
const intents = reviewOrderIntent(sessionStorage, () => crypto.randomUUID());
const app = document.querySelector('#app');
const state = { products: [], policies: [], config: null, signedIn: false, render: 0 };
const money = value => Number(value).toLocaleString('ko-KR') + '원';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const image = value => {
  try { const u = new URL(value); return u.origin === 'https://rconfxsykttfvznakile.supabase.co' ? esc(u.href) : ''; } catch { return ''; }
};
function notify(message) { document.querySelector('#message').textContent = message; }
async function api(path, body, key) {
  const response = await fetch('/review/api' + path, { credentials: 'same-origin', cache: 'no-store',
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(key ? {'idempotency-key':key} : {}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(25000) });
  let data;
  try { data = await response.json(); }
  catch { const error = new Error('서버 응답을 확인하지 못했어요. 추가 결제하지 말고 이전 주문 확인을 눌러 주세요.'); error.status = response.status; throw error; }
  if (!response.ok) { const error = new Error(data.error?.message || '요청을 처리하지 못했어요.'); error.status = response.status; throw error; }
  return data;
}
// Totals are withheld before LIVE or while a product is not on sale; show the line only for real counts.
const quantityLine = p => Number.isSafeInteger(p.totalQuantity) && Number.isSafeInteger(p.openedQuantity) && p.totalQuantity >= 0 && p.openedQuantity >= 0
  ? `전체 ${esc(p.totalQuantity.toLocaleString('ko-KR'))}개 / ${esc(p.openedQuantity.toLocaleString('ko-KR'))}개 오픈` : '';
const cards = () => state.products.length === 0 ? '<p>상품을 준비하고 있어요.</p>' : `<div class="grid">${state.products.map(p => `<a class="card" href="#product/${esc(p.id)}"><img src="${image(p.imageUrl)}" alt="${esc(p.name)}"><div class="body"><h2>${esc(p.name)}</h2><p class="muted">${[esc(p.metadata?.reward), quantityLine(p)].filter(Boolean).join(' · ')}</p><p class="price">${money(p.price)}</p></div></a>`).join('')}</div>`;
const notices = () => `<div class="policies">${state.policies.map(section => `<section><h2>${esc(section.title)}</h2>${section.groups.map(group => `${group.title ? `<h3>${esc(group.title)}</h3>` : ''}<ul>${group.items.map(item => `<li>${esc(item.text)}${item.children ? `<ul>${item.children.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`).join('')}</section>`).join('')}</div>`;
const paymentNotice = () => {
  const ready=reviewPaymentOptions(state.config).map(option=>option.label);
  return `포트원을 통한 나이스페이 연동을 준비하는 심사 웹입니다. ${ready.length ? '나이스페이 TEST 연결이 준비되어 있습니다.' : '나이스페이 결제 연결은 준비 중입니다.'} 계약·입점 승인 완료를 의미하지 않습니다.`;
};
const about = () => `<h1>다뽀바 앱 소개</h1><p>다뽀바는 캐릭터 실물 상품의 포함 구성을 확인하고 구매하는 모바일 서비스입니다.</p><ol><li>가격과 포함 상품, 공개된 구성·확률과 이용 규정을 확인합니다.</li><li>구매 횟수를 선택하고 결제합니다. 결제 전에 지급될 개별 상품을 지정할 수 없습니다.</li><li>결제가 확인되면 구매 횟수만큼 뽑기 권리가 발급됩니다. 캡슐을 열면 서버가 공개된 구성에 따라 포함된 상품 중 1개를 확정합니다. 같은 상품을 받을 수 있습니다.</li><li>획득한 상품은 보관함에서 확인하고 배송을 신청할 수 있습니다. 기본 보관 기간은 60일입니다.</li></ol><p>쿠지는 준비 중이며 아직 구매할 수 없습니다.</p><p>배송 신청 접수 후 배송 완료까지 영업일 기준 2~5일이 소요됩니다.</p><p class="muted">앱 스토어 공개 출시 전입니다. 심사 계정의 주문·재고는 운영 회원과 분리됩니다. ${esc(paymentNotice())}</p><div class="actions"><a class="button" href="#catalog">상품 둘러보기</a><a class="button secondary" href="#policies">서비스 이용 안내</a></div>`;
async function render() {
  const generation = ++state.render;
  notify('');
  document.querySelector('#account-link').textContent = state.signedIn ? '심사 계정' : '로그인';
  const [rawRoute, id] = location.hash.slice(1).split('/');
  const route = rawRoute || 'home';
  if (route === 'home') app.innerHTML = `<div class="hero"><p>DABBOBA · 실물 캐릭터 상품</p><h1>취향을 찾는 작은 설렘,<br>다뽀바에서 만나요.</h1><p>포함 구성을 확인하고 구매하면, 캡슐을 열 때 포함된 상품 중 1개를 확인할 수 있어요. 쿠지는 준비 중입니다.</p><div class="actions"><a class="button" href="#catalog">상품 둘러보기</a><a class="button secondary" href="#about">앱 소개</a></div></div><h2>상품 목록</h2>${cards()}`;
  else if (route === 'catalog') app.innerHTML = `<h1>가챠 상품 목록</h1><p class="muted">실물 상품 정보와 판매 가격을 확인할 수 있습니다. 결제는 심사 계정의 TEST 환경에서만 진행됩니다.</p>${cards()}`;
  else if (route === 'about') app.innerHTML = about();
  else if (route === 'policies') app.innerHTML = `<h1>서비스 이용 안내</h1>${notices()}`;
  else if (route === 'login') login();
  else if (route === 'product' || route === 'checkout') {
    let product = state.products.find(p => p.id === id);
    if (!product && route === "checkout" && intents.read()?.body?.items?.[0]?.productId === id) {
      try {product=await api(`/products/${encodeURIComponent(id)}`);} catch {}
      if (generation !== state.render) return;
    }
    if (!product) { app.innerHTML = '<h1>상품을 찾지 못했어요.</h1>'; return; }
    const odds=await api('/products/'+encodeURIComponent(id)+'/draw-odds');
    if(generation !== state.render)return;
    if (route === 'checkout') checkout(product,odds);
    else app.innerHTML = `<div class="detail-top"><img class="main-photo" src="${image(product.imageUrl)}" alt="${esc(product.name)}"><div><p class="muted">가챠 · 실물 상품</p><h1>${esc(product.name)}</h1><p class="price">1회 ${money(product.price)}</p><p>캡슐을 열면 포함된 상품 중 1개가 지급됩니다. 결제 전에 개별 상품을 지정할 수 없고 같은 상품이 중복될 수 있습니다.</p><p class="muted">배송 신청 후 영업일 2~5일 · 획득일부터 60일 보관</p><a class="button" href="#checkout/${esc(id)}">구매하기</a></div></div><section><h2>포함 상품·공개 확률</h2><div class="grid lineup">${odds.entries.map(e=>`<div class="card"><img src="${image(e.prizeImageUrl)}" alt="${esc(e.prizeName)}"><div class="body"><h3>${esc(e.prizeName)}</h3><p>${esc(e.probabilityPercent)}%</p></div></div>`).join('')}</div></section>${notices()}`;
  } else app.innerHTML = '<h1>페이지를 찾지 못했어요.</h1><a href="#home">메인으로 돌아가기</a>';
}
function login() {
  if (!state.config) { app.innerHTML = '<h1>심사 환경 연결을 준비하고 있어요.</h1><p>앱 소개와 이용 안내를 먼저 확인할 수 있습니다.</p><a class="button" href="#about">앱 소개</a>'; return; }
  if (state.signedIn) {
    app.innerHTML = '<h1>심사 계정으로 로그인되어 있어요.</h1><p>상품 상세에서 구매 및 신용카드 결제창을 확인할 수 있습니다.</p><a class="button" href="#catalog">상품 목록</a><button id="logout" class="secondary">로그아웃</button>';
    document.querySelector('#logout').onclick = async () => { try { await api('/logout', {}); state.signedIn = false; render(); } catch(e) {notify(e.message);} }; return;
  }
  app.innerHTML = `<h1>심사 계정 로그인</h1><p>심사 담당자에게 별도로 전달된 아이디·비밀번호를 사용해 주세요. 비밀번호는 공개 페이지에 표시하지 않습니다.</p><form id="login-form"><label>아이디<input name="email" autocomplete="username" value="pg" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label><label><input name="terms" type="checkbox" required><a href="/terms" target="_blank" rel="noopener">서비스 이용약관</a> 동의 (필수)</label><label><input name="privacy" type="checkbox" required><a href="/privacy" target="_blank" rel="noopener">개인정보처리방침</a> 동의 (필수)</label><button>로그인</button></form>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try { await api('/login', {email:form.email.value.trim(), password:form.password.value, acceptedPolicies:state.config.requiredPolicyVersions}); form.password.value = ''; state.signedIn = true; location.hash = 'catalog'; }
    catch(e) {notify(e.message);} finally {button.disabled = false;}
  };
}
function checkout(product, odds) {
  if (!state.signedIn) { app.innerHTML = '<h1>로그인 후 구매할 수 있어요.</h1><a class="button" href="#login">심사 계정 로그인</a>'; return; }
  const savedIntent = intents.read();
  const available = reviewPaymentOptions(state.config);
  const initialProvider = savedIntent?.body?.reviewPaymentProvider || available[0]?.provider || 'PORTONE_V2_NICE';
  const choices = [{provider:'PORTONE_V2_NICE',label:'포트원 나이스페이'}];
  app.innerHTML = `<h1>상품 주문·결제</h1><form id="checkout-form"><div class="summary"><h2>${esc(product.name)}</h2><p>상품 단가 ${money(product.price)} · 신용카드</p><p class="muted">선택한 결제사의 TEST 환경입니다. 일반 판매와 실제 청구는 시작하지 않았습니다.</p></div><fieldset><legend>심사 결제 방식</legend>${choices.map(c=>`<label><input type="radio" name="provider" value="${c.provider}" ${c.provider===initialProvider?'checked':''} ${!available.some(a=>a.provider===c.provider)||savedIntent?'disabled':''}>${c.label}${available.some(a=>a.provider===c.provider)?' · TEST':' · 연결 준비 중'}</label>`).join('')}</fieldset><label>구매 횟수<select name="quantity" ${savedIntent?'disabled':''}>${Array.from({length:Math.max(savedIntent?.body?.items?.[0]?.quantity || 1,Math.min(10,product.availableQuantity || 0))},(_,i)=>`<option ${i+1===(savedIntent?.body?.items?.[0]?.quantity || 1)?'selected':''}>${i+1}</option>`).join('')}</select></label><label>결제자 이름<input name="fullName" maxlength="30" autocomplete="name" required></label><label>휴대전화<input name="phoneNumber" type="tel" pattern="[0-9+ ]{9,16}|[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}" autocomplete="tel" required></label><label>이메일<input name="customerEmail" type="email" autocomplete="email" required></label><p id="total" class="price">합계 ${money(product.price*(savedIntent?.body?.items?.[0]?.quantity || 1))}</p><label><input name="consent" type="checkbox" required>포함 상품·공개 확률·구매 횟수·금액·취소 및 환불 규정을 확인하고 결제에 동의합니다. (필수)</label><button id="purchase">선택한 결제창 열기</button><button type="button" id="check-payment" class="secondary">이전 주문 확인 / 닫기 복구</button></form>${notices()}`;
  const form = document.querySelector('#checkout-form'), button = document.querySelector('#purchase');
  let busy=false;
  const selectedProvider = () => form.querySelector('input[name="provider"]:checked')?.value;
  const refreshControls = () => {
    const intent=intents.read(), enabled=reviewPaymentOptions(state.config);
    for(const radio of form.querySelectorAll('input[name="provider"]')) radio.disabled=busy || !!intent || !enabled.some(c=>c.provider===radio.value);
    form.quantity.disabled=busy || !!intent;
    button.disabled=busy || !!intent || !product.purchasable || !enabled.some(c=>c.provider===selectedProvider());
    button.textContent=intent?'이전 주문을 먼저 확인해 주세요':enabled.length?'선택한 TEST 결제창 열기':'TEST 결제 연결 준비 중';
  };
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem('dabboba-review-order') || 'null'); } catch { throw new Error('저장된 주문을 확인해 주세요.'); }
  form.quantity.onchange = () => { document.querySelector('#total').textContent = '합계 ' + money(product.price * Number(form.quantity.value)); };
  for(const radio of form.querySelectorAll('input[name="provider"]')) radio.onchange=refreshControls;
  const clear = () => { pending = null; callback = null; intents.clear(); sessionStorage.removeItem('dabboba-review-order'); refreshControls(); };
  function verifySelectedOrder(order, compareDisplayedPrice = false) {
    const saved = intents.read(), selected = saved?.body?.items?.[0], line = order.lines?.[0];
    if (!selected || !line || order.lines.length !== 1 || line.productId !== selected.productId || line.quantity !== selected.quantity
      || (['PAID','FULFILLED'].includes(order.status) && order.drawEntitlementIds?.length !== selected.quantity) || order.pointTotal !== 0 || order.discountTotal !== 0
      || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 1 || (compareDisplayedPrice && selected.productId === product.id && line.unitPrice !== product.price) || line.lineTotal !== line.unitPrice * line.quantity
      || order.subtotal !== line.lineTotal || order.total !== line.lineTotal || (saved.order?.total !== undefined && saved.order.total !== order.total)) throw new Error('선택한 상품과 주문 내용이 달라요. 추가 결제 전에 고객센터에 문의해 주세요.');
    assertReviewPaymentOrder(order,saved.body.reviewPaymentProvider,state.config,false);
    if(saved.order?.cardPayment && ['provider','pgProvider','storeId','merchantId','channelKey','channelEnvironment'].some(k=>saved.order.cardPayment[k]!==order.cardPayment?.[k])) throw new Error('저장된 주문의 결제 채널이 달라요.');
  }
  async function recover() {
    if (callbackError) throw new Error(callbackError);
    const intent = intents.read(), provider=intent?.body?.reviewPaymentProvider;
    if (intent && !['PORTONE_V2_NICE','PORTONE_V2_KICC'].includes(provider)) throw new Error('이전 결제사의 미확인 주문은 고객지원에서 먼저 확인해 주세요.');
    if(callback && callback.provider!==provider) throw new Error('복귀한 결제사와 원래 주문이 달라요. 새 결제는 진행하지 않습니다.');
    if (!pending && intent) {
      pending = await intents.resolve((body, key) => api('/orders', body, key));
      sessionStorage.setItem('dabboba-review-order', JSON.stringify(pending));
    }
    if (!pending) { if(callback) throw new Error('복귀한 결제의 원래 주문을 찾지 못했어요.'); notify('확인할 결제가 없어요.'); return; }
    if(!intent || (intent.order && (intent.order.id!==pending.id || intent.order.paymentId!==pending.paymentId))) throw new Error('저장된 주문이 일치하지 않아요.');
    let order=await api('/orders/'+pending.id);
    if(order.id!==pending.id || order.paymentId!==pending.paymentId) throw new Error('주문 응답이 일치하지 않아요.');
    verifySelectedOrder(order);
    let body = {};
    if (callback?.provider==='TOSSPAYMENTS_DIRECT' && callback.type === 'success') {
      if (callback.orderId !== pending.paymentId) throw new Error('복귀한 결제와 저장된 주문이 달라요. 새 결제는 진행하지 않습니다.');
      body = { paymentKey: callback.paymentKey, orderId: callback.orderId, amount: callback.amount };
    }
    if(['PORTONE_V2_NICE','PORTONE_V2_KICC'].includes(callback?.provider) && callback.paymentId && callback.paymentId!==pending.paymentId) throw new Error('나이스 복귀 주문이 일치하지 않아요.');
    if(!['PAID','FULFILLED','CANCELLED','EXPIRED','FAILED','REFUNDED'].includes(order.status)) {
      await api(reviewPaymentActionPath(provider,pending.paymentId,'confirm'),body);
      order=await api('/orders/'+pending.id);
      if (order.id !== pending.id || order.paymentId !== pending.paymentId) throw new Error('주문 응답이 일치하지 않아요.');
    }
    if (['PAID','FULFILLED'].includes(order.status)) {verifySelectedOrder(order); clear(); notify('서버에서 TEST 결제 완료와 구매 횟수만큼 발급된 뽑기 권리를 확인했어요. 실제 배송은 진행하지 않는 심사 환경입니다.'); return;}
    if (['CANCELLED','EXPIRED','FAILED','REFUNDED'].includes(order.status)) {clear(); notify('종료된 주문이에요. 다시 구매할 수 있습니다.'); return;}
    if (callback?.provider==='TOSSPAYMENTS_DIRECT' && callback.type === 'success') {notify('승인 결과를 확인 중이에요. 추가 결제하지 말고 결제 상태 확인을 눌러 주세요.'); return;}
    try {await api(reviewPaymentActionPath(provider,pending.paymentId,'abandon'),{},'review-abandon:'+pending.paymentId); clear(); notify('결제창을 닫은 주문을 정리했어요. 다시 구매할 수 있습니다.');}
    catch(e) {if(e.status === 409) notify('승인 여부를 확인 중이에요. 추가 결제하지 말고 잠시 후 결제 상태 확인을 눌러 주세요.'); else throw e;}
  }
  document.querySelector('#check-payment').onclick = async () => {if(busy)return;busy=true;refreshControls();try {await recover();} catch(e){notify(e.message);}finally{busy=false;refreshControls();}};
  refreshControls();
  if (callback || callbackError) {busy=true;refreshControls();void recover().catch(e=>notify(e.message)).finally(()=>{busy=false;refreshControls();});}
  form.onsubmit = async event => {
    event.preventDefault(); if(busy)return;busy=true;button.disabled = true;
    try {
      const provider=selectedProvider();
      state.config = await api('/config');
      const connection=reviewPaymentOptions(state.config).find(c=>c.provider===provider);
      if (!connection) throw new Error('선택한 TEST 결제사의 연결을 준비 중이에요.');
      if (new TextEncoder().encode(form.fullName.value.trim()).length > 30) throw new Error('결제자 이름은 30바이트 이내로 입력해 주세요.');
      if (!window.PortOne?.requestPayment) throw new Error('결제창을 불러오지 못했어요. 페이지를 새로 열어 주세요.');
      if (pending || callback || intents.read()) throw new Error('이전 주문 확인을 먼저 눌러 주세요.');
      const currentProduct = await api(`/products/${product.id}`);
      const currentOdds=await api('/products/'+encodeURIComponent(product.id)+'/draw-odds');
      if (currentOdds.version!==odds.version || currentProduct.metadata?.purchaseMode === 'DIRECT' || !currentProduct.purchasable || currentProduct.price !== product.price) throw new Error('선택한 상품의 판매 상태를 다시 확인해 주세요.');
      intents.prepare({items:[{productId:product.id,quantity:Number(form.quantity.value),expectedDrawVersion:odds.version}],pointAmount:0,reviewPaymentProvider:provider,cardPg:'NICE'});
      const order = await intents.resolve((body, key) => api('/orders', body, key));
      pending = {id:order.id,paymentId:order.paymentId}; sessionStorage.setItem('dabboba-review-order',JSON.stringify(pending));
      const currentOrder = await api('/orders/' + order.id);
      if (currentOrder.id !== order.id || currentOrder.paymentId !== order.paymentId || currentOrder.status !== 'PENDING_PAYMENT') throw new Error('주문 상태가 바뀌었어요. 이전 주문 확인을 눌러 주세요.');
      verifySelectedOrder(currentOrder,true);
      assertReviewPaymentOrder(currentOrder,provider,state.config);
      await api(reviewPaymentActionPath(provider,order.paymentId,'attempt'),{});
      await window.PortOne.requestPayment(portOnePaymentRequest(currentOrder,product,form,location.origin,state.config,provider));
      await recover();
    } catch(e) {notify(e?.code?'결제 요청을 완료하지 못했어요. 이전 주문 확인을 눌러 주세요.':e.message);}
    finally {busy=false;refreshControls();}
  };
}
addEventListener('hashchange', () => { window.scrollTo(0,0); render().catch(e=>notify(e.message)); });
try {
  const policies = await fetch('/review/policies.json').then(r=>{if(!r.ok)throw new Error('이용 안내를 불러오지 못했어요.');return r.json();});
  state.policies = policies;
  const [products, config] = await Promise.allSettled([api('/products'),api('/config')]);
  state.products = products.status === 'fulfilled' ? products.value.items.filter(p => p.metadata?.purchaseMode !== 'DIRECT') : [];
  state.config = config.status === 'fulfilled' ? config.value : null;
  if (state.config) { try {await api('/me');state.signedIn = true;} catch(e) {if(e.status !== 401)throw e;} }
  await render();
  if (products.status === 'rejected' || config.status === 'rejected') notify('심사 상품·결제 연결을 준비하고 있어요. 앱 소개와 이용 안내는 확인할 수 있습니다.');
} catch(e) {app.innerHTML = '<h1>서비스 연결을 확인해 주세요.</h1><p>잠시 후 페이지를 새로 열어 주세요.</p>';notify(e.message);}
