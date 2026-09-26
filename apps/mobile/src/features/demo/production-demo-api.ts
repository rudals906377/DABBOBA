import { readAuthTokens } from "@/lib/session-store";

export class InternalCustomerDataCleanupError extends Error {
  constructor() {
    super("이전 계정의 기기 데이터를 정리하지 못했습니다. 다시 시도해 주세요.");
    this.name = "InternalCustomerDataCleanupError";
  }
}

export class TemporaryDemoCapabilityError extends Error {
  constructor() {
    super("개발용 기능을 사용할 수 없습니다.");
    this.name = "TemporaryDemoCapabilityError";
  }
}

export async function ensureInternalCustomerSession(): Promise<null> {
  return null;
}

export async function fetchDemoCapabilities(): Promise<null> {
  return null;
}

export async function transitionDemoPayment(): Promise<never> {
  throw new Error("개발용 결제는 운영 빌드에서 사용할 수 없습니다.");
}

export async function sessionStillCurrent(accessToken: string): Promise<boolean> {
  return (await readAuthTokens())?.accessToken === accessToken;
}
