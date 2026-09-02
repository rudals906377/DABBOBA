import { randomUUID } from "expo-crypto";
import { isKujiRoomEndpointUnavailable } from "@/features/kuji/kuji-queue-state";

export type KujiRoomEntryState =
  | "WAITING"
  | "CHECKOUT_PENDING"
  | "DRAWING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type KujiRoomWaitingPerson = {
  entryId: string;
  displayName: string;
  position: number;
  isViewer: boolean;
};

export type KujiRoomActivePerson = {
  displayName: string;
  phase: "CHECKOUT_PENDING" | "DRAWING";
  checkoutExpiresAt: string | null;
};

export type KujiRecentDrawActivity = {
  id: string;
  displayName: string;
  prizeName: string;
  prizeImageUrl: string | null;
  rarity: string;
  committedAt: string;
};

export type KujiRoomViewer = {
  entryId: string;
  state: KujiRoomEntryState;
  position: number | null;
  peopleAhead: number;
  checkoutExpiresAt: string | null;
};

export type KujiRoomSnapshot = {
  serverNow: string;
  version: number;
  productId: string;
  viewer: KujiRoomViewer;
  active: KujiRoomActivePerson | null;
  waitingCount: number;
  waitingPeople: KujiRoomWaitingPerson[];
  recentActivity: KujiRecentDrawActivity[];
};

export class KujiRoomApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KujiRoomApiError";
    this.status = status;
  }
}

export async function joinKujiRoom(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
): Promise<KujiRoomSnapshot> {
  return requestKujiRoom(apiBaseUrl, accessToken, productId, "POST");
}

export async function fetchKujiRoom(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
  entryId: string,
): Promise<KujiRoomSnapshot> {
  return requestKujiRoom(apiBaseUrl, accessToken, productId, "GET", entryId);
}

export async function leaveKujiRoom(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
  entryId: string,
): Promise<KujiRoomSnapshot> {
  return requestKujiRoom(apiBaseUrl, accessToken, productId, "DELETE", entryId);
}

export function isKujiRoomApiUnavailable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof KujiRoomApiError)) return false;
  return isKujiRoomEndpointUnavailable(error.status, error.message);
}

async function requestKujiRoom(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
  method: "POST" | "GET" | "DELETE",
  entryId?: string,
): Promise<KujiRoomSnapshot> {
  const roomPath = `/v1/kuji/rooms/${encodeURIComponent(productId)}/entries`;
  const entryPath = entryId ? `${roomPath}/${encodeURIComponent(entryId)}` : roomPath;
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${entryPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Request-Id": randomUUID(),
      ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
    },
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new KujiRoomApiError(readErrorMessage(body, response.status), response.status);
  }
  return parseKujiRoomSnapshot(body);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KujiRoomApiError("쿠지 대기실 응답을 확인하지 못했습니다.", response.status);
  }
}

function readErrorMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (isRecord(body.error) && typeof body.error.message === "string" && body.error.message.trim()) {
      return body.error.message;
    }
  }
  if (status === 409) return "다른 쿠지 상품에서 이미 대기하거나 진행 중이에요.";
  if (status === 401) return "로그인 정보를 다시 확인해 주세요.";
  return "쿠지 대기실을 불러오지 못했습니다.";
}

function parseKujiRoomSnapshot(value: unknown): KujiRoomSnapshot {
  if (!isRecord(value)) throw invalidSnapshot();
  const waitingPeople = Array.isArray(value.waitingPeople)
    ? value.waitingPeople.map(readWaitingPerson)
    : null;
  const recentActivity = Array.isArray(value.recentActivity)
    ? value.recentActivity.map(readDrawActivity)
    : null;
  const active = value.active === null ? null : readActivePerson(value.active);
  const viewer = readViewer(value.viewer);

  if (
    typeof value.serverNow !== "string"
    || typeof value.productId !== "string"
    || waitingPeople === null
    || recentActivity === null
  ) {
    throw invalidSnapshot();
  }

  return {
    serverNow: value.serverNow,
    version: readNonNegativeInteger(value.version, "version"),
    productId: value.productId,
    viewer,
    active,
    waitingCount: readNonNegativeInteger(value.waitingCount, "waitingCount"),
    waitingPeople,
    recentActivity,
  };
}

function readViewer(value: unknown): KujiRoomViewer {
  if (
    !isRecord(value)
    || typeof value.entryId !== "string"
    || !(value.position === null || (typeof value.position === "number" && Number.isInteger(value.position) && value.position >= 0))
    || !(value.checkoutExpiresAt === null || typeof value.checkoutExpiresAt === "string")
  ) {
    throw invalidSnapshot();
  }
  return {
    entryId: value.entryId,
    state: readRoomState(value.state),
    position: value.position,
    peopleAhead: readNonNegativeInteger(value.peopleAhead, "peopleAhead"),
    checkoutExpiresAt: value.checkoutExpiresAt,
  };
}

function readWaitingPerson(value: unknown): KujiRoomWaitingPerson {
  if (
    !isRecord(value)
    || typeof value.entryId !== "string"
    || typeof value.displayName !== "string"
    || typeof value.isViewer !== "boolean"
  ) {
    throw invalidSnapshot();
  }
  return {
    entryId: value.entryId,
    displayName: value.displayName,
    position: readNonNegativeInteger(value.position, "position"),
    isViewer: value.isViewer,
  };
}

function readActivePerson(value: unknown): KujiRoomActivePerson {
  if (
    !isRecord(value)
    || typeof value.displayName !== "string"
    || (value.phase !== "CHECKOUT_PENDING" && value.phase !== "DRAWING")
    || !(value.checkoutExpiresAt === null || typeof value.checkoutExpiresAt === "string")
  ) {
    throw invalidSnapshot();
  }
  return {
    displayName: value.displayName,
    phase: value.phase,
    checkoutExpiresAt: value.checkoutExpiresAt,
  };
}

function readDrawActivity(value: unknown): KujiRecentDrawActivity {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.displayName !== "string"
    || typeof value.prizeName !== "string"
    || !(value.prizeImageUrl === null || typeof value.prizeImageUrl === "string")
    || typeof value.rarity !== "string"
    || typeof value.committedAt !== "string"
  ) {
    throw invalidSnapshot();
  }
  return {
    id: value.id,
    displayName: value.displayName,
    prizeName: value.prizeName,
    prizeImageUrl: value.prizeImageUrl,
    rarity: value.rarity,
    committedAt: value.committedAt,
  };
}

function readRoomState(value: unknown): KujiRoomEntryState {
  if (
    value === "WAITING"
    || value === "CHECKOUT_PENDING"
    || value === "DRAWING"
    || value === "COMPLETED"
    || value === "CANCELLED"
    || value === "EXPIRED"
  ) return value;
  throw invalidSnapshot();
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new KujiRoomApiError(`쿠지 대기실의 ${field} 값이 올바르지 않습니다.`, 500);
  }
  return value;
}

function invalidSnapshot(): KujiRoomApiError {
  return new KujiRoomApiError("쿠지 대기실 응답 형식이 올바르지 않습니다.", 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
