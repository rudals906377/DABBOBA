export type KujiQueueParticipantState = "ACTIVE" | "WAITING";

export type KujiQueueParticipant = {
  userId: string;
  displayName: string;
  sequence: number;
  state: KujiQueueParticipantState;
  expiresAt?: string;
};

export const KUJI_SESSION_LIMIT_SECONDS = 5 * 60;

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
