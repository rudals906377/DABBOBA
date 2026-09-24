export class InternalCustomerDataCleanupError extends Error {
  constructor() {
    super("이전 계정의 기기 데이터를 정리하지 못했습니다. 다시 시도해 주세요.");
    this.name = "InternalCustomerDataCleanupError";
  }
}

export async function ensureInternalCustomerSession(): Promise<null> {
  return null;
}
