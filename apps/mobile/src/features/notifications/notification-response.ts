import * as Notifications from "expo-notifications";
import {
  buildKujiRoomGatePath,
  resolveKujiTurnNotificationPath,
  type KujiTurnCall,
} from "@/features/kuji/kuji-entry-state";
import {
  isSafeNotificationIdentifier,
  resolveAccountNotificationResponsePath,
} from "@/features/notifications/notification-navigation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A kuji turn tap always returns to the authoritative product room gate. The
 * product ID must pass the shared safe-identifier check; lease details that
 * are missing or malformed never block that gate, which rechecks the entry.
 */
export function resolveKujiTurnResponsePath(data: unknown, openedAtMs: number): string | null {
  if (!isRecord(data) || data.kind !== "KUJI_TURN") return null;
  const productId = data.productId;
  if (!isSafeNotificationIdentifier(productId)) return null;
  if (
    !isSafeNotificationIdentifier(data.entryId)
    || typeof data.checkoutExpiresAt !== "string"
    || typeof data.serverNow !== "string"
  ) {
    return buildKujiRoomGatePath(productId);
  }
  const call: KujiTurnCall = {
    productId,
    entryId: data.entryId,
    title: "차례가 됐어요",
    body: "결제 대기 시간이 시작되었어요.",
    checkoutExpiresAt: data.checkoutExpiresAt,
    serverNow: data.serverNow,
    developmentFixture: data.kujiRoomFixture === "development",
  };
  return resolveKujiTurnNotificationPath(call, openedAtMs);
}

/** Kind-based dispatch for every notification tap the app understands. */
export function resolveNotificationResponsePath(data: unknown, openedAtMs: number): string | null {
  if (!isRecord(data)) return null;
  switch (data.kind) {
    case "ACCOUNT_NOTIFICATION":
      return resolveAccountNotificationResponsePath(data);
    case "KUJI_TURN":
      return resolveKujiTurnResponsePath(data, openedAtMs);
    default:
      return null;
  }
}

type DispatcherInstallation = {
  observers: number;
  navigate: (path: string) => void;
  remove: () => void;
};

let installation: DispatcherInstallation | null = null;

/**
 * Installs the one notification-response dispatcher. Several observers may
 * call this; the first installs the listener and handles the launch
 * (last) response exactly once through the kind-based dispatcher, so the
 * mount order of the observers can never drop or double-open a response.
 * Returns an idempotent release; the listener is removed with the last one.
 */
export function installNotificationResponseDispatcher(navigate: (path: string) => void): () => void {
  if (installation) {
    installation.observers += 1;
    installation.navigate = navigate;
  } else {
    const current: DispatcherInstallation = { observers: 1, navigate, remove: () => undefined };
    installation = current;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const path = resolveNotificationResponsePath(response.notification.request.content.data, Date.now());
      if (!path) return;
      current.navigate(path);
      Notifications.clearLastNotificationResponse();
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    current.remove = () => subscription.remove();
  }
  const owner = installation;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owner.observers -= 1;
    if (owner.observers === 0) {
      owner.remove();
      if (installation === owner) installation = null;
    }
  };
}
