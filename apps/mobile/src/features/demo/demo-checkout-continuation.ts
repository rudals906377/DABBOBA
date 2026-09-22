export type DemoCheckoutOrder = {
  id: string;
  status: string;
};

export async function continuePendingDemoCheckout<T extends DemoCheckoutOrder>(input: {
  enabled: boolean;
  order: T;
  approve: (orderId: string) => Promise<T>;
  isCurrent: () => boolean | Promise<boolean>;
}): Promise<T | null> {
  if (!(await input.isCurrent())) return null;
  if (!input.enabled || input.order.status !== "PENDING_PAYMENT") return input.order;

  const transitioned = await input.approve(input.order.id);
  if (!(await input.isCurrent())) return null;
  if (transitioned.id !== input.order.id) {
    throw new Error("현재 주문을 안전하게 다시 확인하지 못했습니다.");
  }
  return transitioned;
}
