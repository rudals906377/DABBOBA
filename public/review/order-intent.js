const KEY = 'dabboba-review-order-intent';
const WINDOW_MS = 24 * 60 * 60 * 1000;
// Statuses that may still hide a created order or need the same request again:
// sign-in/consent, timeout, early data and rate limits. Network errors have no status.
const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 425, 429]);

// The server refused this request: its transaction rolled back and no order exists.
export function isDefinitiveOrderRejection(status) {
  return Number.isInteger(status) && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status);
}

// Persist before the first POST. An unknown response is never a new purchase.
export function reviewOrderIntent(storage, uuid, now = Date.now) {
  const read = () => {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.key?.startsWith('web-order:') || !value.body?.items?.[0]?.productId || !Number.isFinite(value.createdAt)) {
      throw new Error('저장된 주문을 확인하지 못했어요. 고객센터에 문의해 주세요.');
    }
    return value;
  };
  return {
    read,
    prepare(body) {
      const existing = read();
      if (existing) {
        if (existing.body.items[0].productId !== body.items[0].productId || existing.body.items[0].quantity !== body.items[0].quantity
          || (existing.body.cardPg || 'INICIS') !== (body.cardPg || 'INICIS')) {
          throw new Error('이전 주문 상태를 먼저 확인해 주세요.');
        }
        return existing;
      }
      const value = { key: 'web-order:' + uuid(), body, createdAt: now(), order: null };
      storage.setItem(KEY, JSON.stringify(value));
      return value;
    },
    async resolve(post) {
      const value = read();
      if (!value) throw new Error('저장된 주문 요청이 없어요.');
      if (value.order) return value.order;
      if (now() - value.createdAt >= WINDOW_MS) throw new Error('확인되지 않은 주문은 고객센터에서 확인해 주세요. 새 결제는 진행하지 않습니다.');
      let order;
      try {
        order = await post(value.body, value.key);
      } catch (error) {
        // A refused request (out of stock, invalid input) created nothing, so forget it and let
        // the reviewer change the quantity or retry. Unknown outcomes keep the key for a replay.
        // A 409 for a still-running duplicate can leave a PENDING_PAYMENT order behind; no payment
        // is ever opened for it here, so the server expires it.
        if (isDefinitiveOrderRejection(error?.status)) storage.removeItem(KEY);
        throw error;
      }
      const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      if (!idPattern.test(order?.id) || !idPattern.test(order?.paymentId)) throw new Error('주문 응답을 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      value.order = { id: order.id, paymentId: order.paymentId, total: order.total, ...(order.cardPayment ? {cardPayment:order.cardPayment} : {}) };
      storage.setItem(KEY, JSON.stringify(value));
      return value.order;
    },
    clear() { storage.removeItem(KEY); },
  };
}
