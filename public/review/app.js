import { reviewOrderIntent } from './order-intent.js';
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
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error?.message || '요청을 처리하지 못했어요.'); error.status = response.status; throw error; }
  return data;
}
const cards = () => `<div class="grid">${state.products.map(p => `<a class="card" href="#product/${esc(p.id)}"><img src="${image(p.imageUrl)}" alt="${esc(p.name)}"><div class="body"><h2>${esc(p.name)}</h2><p class="muted">${esc(p.metadata?.reward)} · 전체 ${p.totalQuantity}개 / ${p.openedQuantity}개 오픈</p><p class="price">${money(p.price)}</p></div></a>`).join('')}</div>`;
const notices = () => `<div class="policies">${state.policies.map(section => `<section><h2>${esc(section.title)}</h2>${section.groups.map(group => `${group.title ? `<h3>${esc(group.title)}</h3>` : ''}<ul>${group.items.map(item => `<li>${esc(item.text)}${item.children ? `<ul>${item.children.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`).join('')}</section>`).join('')}</div>`;
const about = () => `<h1>다뽀바 앱 소개</h1><p>다뽀바는 캐릭터 피규어와 캡슐 상품을 탐색하고, 무작위 구성의 실물 상품을 구매하는 모바일 서비스입니다.</p><ol><li>상품의 가격, 포함 상품, 전체·오픈 수량과 이용 규정을 확인합니다.</li><li>결제를 완료하면 구매 수량만큼 뽑기 권리가 발급됩니다.</li><li>앱에서 캡슐을 직접 열면 서버가 남은 구성에 따라 획득 상품을 확정합니다. 같은 상품이 중복될 수 있습니다.</li><li>획득한 상품은 보관함에서 확인하고 배송을 신청할 수 있습니다. 보관 기간은 60일입니다.</li></ol><p>배송 신청 접수 후 배송 완료까지 영업일 기준 2~5일이 소요됩니다. 출시 초기에는 가챠 상품만 제공하며 쿠지는 아직 판매하지 않습니다.</p><p class="muted">앱 스토어 공개 출시 전입니다. 이 웹 화면은 계약 심사를 위한 서비스 확인 경로이며, 심사 계정의 주문·재고는 운영 회원과 분리됩니다. 현재 결제창은 KG이니시스 TEST입니다. KCP 결제 연동은 별도 준비 사항입니다.</p><div class="actions"><a class="button" href="#catalog">판매 예정 상품 확인</a><a class="button secondary" href="#policies">서비스 이용 안내</a></div>`;
async function render() {
  const generation = ++state.render;
  notify('');
  document.querySelector('#account-link').textContent = state.signedIn ? '심사 계정' : '로그인';
  const [rawRoute, id] = location.hash.slice(1).split('/');
  const route = rawRoute || 'home';
  if (route === 'home') app.innerHTML = `<div class="hero"><p>DABBOBA · 실물 캐릭터 상품</p><h1>취향을 찾는 작은 설렘,<br>다뽀바에서 만나요.</h1><p>상품을 살펴보고, 앱에서 캡슐을 열고, 보관함에서 배송을 신청하세요.</p><div class="actions"><a class="button" href="#catalog">상품 둘러보기</a><a class="button secondary" href="#about">앱 소개</a></div></div><h2>상품 목록</h2>${cards()}`;
  else if (route === 'catalog') app.innerHTML = `<h1>가챠 상품 목록</h1><p class="muted">실물 상품 정보와 판매 가격을 확인할 수 있습니다. 결제는 심사 계정의 TEST 환경에서만 진행됩니다.</p>${cards()}`;
  else if (route === 'about') app.innerHTML = about();
  else if (route === 'policies') app.innerHTML = `<h1>서비스 이용 안내</h1>${notices()}`;
  else if (route === 'login') login();
  else if (route === 'product' || route === 'checkout') {
    const product = state.products.find(p => p.id === id);
    if (!product) { app.innerHTML = '<h1>상품을 찾지 못했어요.</h1>'; return; }
    app.innerHTML = '<p>상품 구성을 확인하고 있어요.</p>';
    const odds = await api(`/products/${id}/draw-odds`);
    if (generation !== state.render) return;
    if (route === 'checkout') checkout(product, odds);
    else app.innerHTML = `<div class="detail-top"><img class="main-photo" src="${image(product.imageUrl)}" alt="${esc(product.name)}"><div><p class="muted">가챠 · 실물 상품</p><h1>${esc(product.name)}</h1><p class="price">${money(product.price)}</p><p>${esc(product.metadata?.reward)}</p><p>전체 ${product.totalQuantity}개 / ${product.openedQuantity}개 오픈</p><p class="muted">배송 신청 후 영업일 2~5일 · 60일 보관<br>가챠 배송 신청 합계 24,900원 이상 무료배송</p><a class="button" href="#checkout/${id}">뽑으러 가기</a></div></div><section><h2>포함 상품</h2><p class="muted">남은 구성 수량에 따라 무작위로 지급되며 동일 상품을 여러 번 받을 수 있습니다. 심사 환경의 내부 수량은 별도로 배분된 시험 재고입니다.</p><div class="grid lineup">${odds.entries.map(e => `<div class="card"><img src="${image(e.prizeImageUrl)}" alt="${esc(e.prizeName)}"><div class="body">${esc(e.prizeName)}</div></div>`).join('')}</div></section>${notices()}`;
  } else app.innerHTML = '<h1>페이지를 찾지 못했어요.</h1><a href="#home">메인으로 돌아가기</a>';
}
function login() {
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
  app.innerHTML = `<h1>구매 및 결제</h1><form id="checkout-form"><div class="summary"><h2>${esc(product.name)}</h2><p>상품 단가 ${money(product.price)} · 신용카드</p><p class="muted">KG이니시스 TEST · 카드 정보 입력 및 최종 결제는 심사 담당자의 지시에 따라 진행해 주세요.</p></div><label>구매 수량<select name="quantity">${Array.from({length:Math.min(10,product.availableQuantity)},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label><label>결제자 이름<input name="fullName" maxlength="30" autocomplete="name" required></label><label>휴대전화<input name="phoneNumber" type="tel" pattern="[0-9+ -]{9,16}" autocomplete="tel" required></label><label>이메일<input name="customerEmail" type="email" autocomplete="email" required></label><p id="total" class="price">합계 ${money(product.price)}</p><label><input name="consent" type="checkbox" required>상품 구성·무작위 지급 방식·취소 및 환불 규정을 확인하고 결제에 동의합니다. (필수)</label><button id="purchase">구매하기</button><button type="button" id="check-payment" class="secondary">결제 상태 확인 / 닫기 복구</button></form>${notices()}`;
  const form = document.querySelector('#checkout-form');
  let pending; try { pending = JSON.parse(sessionStorage.getItem('dabboba-review-order') || 'null'); } catch {pending = null;}
  form.quantity.onchange = () => { document.querySelector('#total').textContent = '합계 ' + money(product.price * Number(form.quantity.value)); };
  async function recover() {
    if (!pending && intents.read()) {
      pending = await intents.resolve((body, key) => api('/orders', body, key));
      sessionStorage.setItem('dabboba-review-order', JSON.stringify(pending));
    }
    if (!pending) {notify('확인할 결제가 없어요.'); return;}
    const order = await api('/orders/' + pending.id);
    if (['PAID','FULFILLED'].includes(order.status)) { notify('서버에서 결제 완료를 확인했어요. 실제 상품 획득·배송은 앱에서 진행합니다.'); return; }
    if (['CANCELLED','EXPIRED','FAILED','REFUNDED'].includes(order.status)) {pending = null; intents.clear(); sessionStorage.removeItem('dabboba-review-order'); notify('종료된 주문이에요. 다시 구매할 수 있습니다.'); return;}
    try {await api(`/payments/${pending.paymentId}/abandon`, {}, 'web-abandon:' + pending.id); pending = null;intents.clear();sessionStorage.removeItem('dabboba-review-order');notify('결제창을 닫은 주문을 정리했어요. 다시 구매할 수 있습니다.');}
    catch(e) { if(e.status === 409) {await api(`/payments/${pending.paymentId}/confirm`, {});notify('결제 정보를 다시 확인했어요. 결제 상태 확인을 눌러 주세요.');} else throw e; }
  }
  document.querySelector('#check-payment').onclick = async () => {try {await recover();} catch(e){notify(e.message);}};
  form.onsubmit = async event => {
    event.preventDefault(); const button = document.querySelector('#purchase'); button.disabled = true;
    try {
      if (new TextEncoder().encode(form.fullName.value.trim()).length > 30) throw new Error('결제자 이름은 30바이트 이내로 입력해 주세요.');
      if (!window.PortOne?.requestPayment) throw new Error('결제창 연결을 준비하지 못했어요. 페이지를 새로 열어 주세요.');
      if (pending) {await recover(); if(pending) throw new Error('이전 결제 상태를 확인한 후 다시 시도해 주세요.');}
      const currentOdds = await api(`/products/${product.id}/draw-odds`);
      intents.prepare({items:[{productId:product.id,quantity:Number(form.quantity.value),expectedDrawVersion:currentOdds.version}],pointAmount:0});
      const order = await intents.resolve((body, key) => api('/orders', body, key));
      pending = {id:order.id,paymentId:order.paymentId}; sessionStorage.setItem('dabboba-review-order',JSON.stringify(pending));
      await api(`/payments/${order.paymentId}/attempt`, {});
      const response = await window.PortOne.requestPayment({storeId:'store-08e382ae-230f-46e8-a1d3-30e28ae31d3a',channelKey:'channel-key-f21d589c-94b2-4801-921a-f6f926e6dccc',paymentId:order.paymentId,orderName:product.name,totalAmount:order.total,currency:'KRW',payMethod:'CARD',productType:'REAL',customer:{fullName:form.fullName.value.trim(),phoneNumber:form.phoneNumber.value.replace(/[ -]/g,''),email:form.customerEmail.value.trim()},redirectUrl:location.origin + '/review/?return=1#checkout/' + product.id});
      if (response?.code) {await recover();} else {await api(`/payments/${order.paymentId}/confirm`, {});notify('결제 확인 요청을 접수했어요. 결제 상태 확인을 눌러 주세요.');}
    } catch(e) {notify(e.message);} finally {button.disabled = false;}
  };
}
addEventListener('hashchange', () => { window.scrollTo(0,0); render().catch(e=>notify(e.message)); });
try {
  const [products, policies, config] = await Promise.all([api('/products'), fetch('/review/policies.json').then(r=>{if(!r.ok)throw new Error('이용 안내를 불러오지 못했어요.');return r.json();}),api('/config')]);
  state.products = products.items; state.policies = policies; state.config = config;
  try {await api('/me');state.signedIn = true;} catch(e) {if(e.status !== 401)throw e;}
  await render();
} catch(e) {app.innerHTML = '<h1>서비스 연결을 확인해 주세요.</h1><p>잠시 후 페이지를 새로 열어 주세요.</p>';notify(e.message);}
