import type {
  KujiRecentDrawActivity,
  KujiRoomSnapshot,
} from "@/features/kuji/kuji-room-api";

export type KujiQueueParticipantState = "ACTIVE" | "WAITING";

export type KujiQueueParticipant = {
  userId: string;
  displayName: string;
  sequence: number;
  state: KujiQueueParticipantState;
  expiresAt?: string;
};

export const KUJI_SESSION_LIMIT_SECONDS = 5 * 60;
export const KUJI_LOCAL_CHECKOUT_SECONDS = 3 * 60;

export function isKujiRoomEndpointUnavailable(status: number, message: string): boolean {
  if ([405, 501, 502, 503, 504].includes(status)) return true;
  if (status !== 404) return false;
  return /route\b.*\bnot found/i.test(message)
    || message === "쿠지 대기실 응답을 확인하지 못했습니다.";
}

export type KujiQueueSnapshot = {
  productId: string;
  viewerUserId: string;
  active: KujiQueueParticipant | null;
  waiting: KujiQueueParticipant[];
};

export type KujiQueuePersonView = KujiQueueParticipant & {
  position: number;
  isViewer: boolean;
};

export type KujiQueueView = {
  orderedPeople: KujiQueuePersonView[];
  peopleAhead: KujiQueuePersonView[];
  viewerPosition: number | null;
  peopleAheadCount: number;
  canEnter: boolean;
};

export function buildKujiQueueView(snapshot: KujiQueueSnapshot): KujiQueueView {
  const active = snapshot.active?.state === "ACTIVE" ? snapshot.active : null;
  const activeUserId = active?.userId;
  const waiting = snapshot.waiting
    .filter((person) => person.state === "WAITING" && person.userId !== activeUserId)
    .slice()
    .sort((left, right) => left.sequence - right.sequence);
  const queue = active ? [active, ...waiting] : waiting;
  const orderedPeople = queue.map((person, index) => ({
    ...person,
    position: index + 1,
    isViewer: person.userId === snapshot.viewerUserId,
  }));
  const viewerIndex = orderedPeople.findIndex((person) => person.isViewer);

  return {
    orderedPeople,
    peopleAhead: viewerIndex > 0 ? orderedPeople.slice(0, viewerIndex) : [],
    viewerPosition: viewerIndex >= 0 ? viewerIndex + 1 : null,
    peopleAheadCount: Math.max(viewerIndex, 0),
    canEnter: Boolean(active && active.userId === snapshot.viewerUserId),
  };
}

export function createKujiQueueExample(productId: string): KujiQueueSnapshot {
  return {
    productId,
    viewerUserId: "local-viewer",
    active: {
      userId: "example-active",
      displayName: "럭키덕후",
      sequence: 10,
      state: "ACTIVE",
      expiresAt: new Date(Date.now() + 4 * 60_000 + 12_000).toISOString(),
    },
    waiting: [
      { userId: "example-first", displayName: "쿠지마스터", sequence: 11, state: "WAITING" },
      { userId: "example-second", displayName: "애니콜렉터", sequence: 12, state: "WAITING" },
      { userId: "local-viewer", displayName: "나", sequence: 13, state: "WAITING" },
    ],
  };
}

export function kujiRemainingSeconds(expiresAt: string | undefined, nowMs: number): number {
  if (!expiresAt) return 0;
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.min(KUJI_SESSION_LIMIT_SECONDS, Math.ceil((deadline - nowMs) / 1_000)));
}

export function formatKujiRemainingTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.min(KUJI_SESSION_LIMIT_SECONDS, Math.trunc(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function createKujiRoomFallback(
  productId: string,
  startedAtMs: number,
): KujiRoomSnapshot {
  const serverNow = new Date(startedAtMs).toISOString();
  const entryId = `dev-kuji-${encodeURIComponent(productId)}`;
  if (!usesOccupiedFallback(productId)) {
    return {
      serverNow,
      version: 1,
      productId,
      viewer: {
        entryId,
        state: "CHECKOUT_PENDING",
        position: null,
        peopleAhead: 0,
        checkoutExpiresAt: new Date(
          startedAtMs + KUJI_LOCAL_CHECKOUT_SECONDS * 1_000,
        ).toISOString(),
        drawingExpiresAt: null,
      },
      active: {
        displayName: "나",
        phase: "CHECKOUT_PENDING",
        checkoutExpiresAt: new Date(
          startedAtMs + KUJI_LOCAL_CHECKOUT_SECONDS * 1_000,
        ).toISOString(),
      },
      waitingCount: 0,
      waitingPeople: [],
      recentActivity: buildFallbackRecentActivity(startedAtMs),
    };
  }

  return {
    serverNow,
    version: 1,
    productId,
    viewer: {
      entryId,
      state: "WAITING",
      position: 3,
      peopleAhead: 2,
      checkoutExpiresAt: null,
      drawingExpiresAt: null,
    },
    active: {
      displayName: "럭키덕후",
      phase: "DRAWING",
      checkoutExpiresAt: null,
    },
    waitingCount: 3,
    waitingPeople: [
      { entryId: "dev-waiter-1", displayName: "쿠지마스터", position: 1, isViewer: false },
      { entryId: "dev-waiter-2", displayName: "애니콜렉터", position: 2, isViewer: false },
      { entryId, displayName: "나", position: 3, isViewer: true },
    ],
    recentActivity: buildFallbackRecentActivity(startedAtMs),
  };
}

export function sortKujiRecentActivity(
  activity: KujiRecentDrawActivity[],
): KujiRecentDrawActivity[] {
  return activity.slice().sort((left, right) => (
    Date.parse(right.committedAt) - Date.parse(left.committedAt)
  ));
}

export function formatKujiActivityAge(committedAt: string, serverNow: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.parse(serverNow) - Date.parse(committedAt)) / 1_000),
  );
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 10) return "방금";
  if (elapsedSeconds < 60) return `${elapsedSeconds}초 전`;
  return `${Math.floor(elapsedSeconds / 60)}분 전`;
}

function usesOccupiedFallback(productId: string): boolean {
  return productId.toLowerCase().includes("evangelion");
}

function buildFallbackRecentActivity(startedAtMs: number): KujiRecentDrawActivity[] {
  return [
    {
      id: "dev-result-3",
      displayName: "모찌캡슐",
      prizeName: "A상 피규어",
      prizeImageUrl: null,
      rarity: "A",
      committedAt: new Date(startedAtMs - 8_000).toISOString(),
    },
    {
      id: "dev-result-2",
      displayName: "럭키레버",
      prizeName: "C상 아크릴 스탠드",
      prizeImageUrl: null,
      rarity: "C",
      committedAt: new Date(startedAtMs - 27_000).toISOString(),
    },
    {
      id: "dev-result-1",
      displayName: "뽀바좋아",
      prizeName: "D상 클리어 파일",
      prizeImageUrl: null,
      rarity: "D",
      committedAt: new Date(startedAtMs - 63_000).toISOString(),
    },
  ];
}
