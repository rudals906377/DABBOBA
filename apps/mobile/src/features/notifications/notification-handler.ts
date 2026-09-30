import * as Notifications from "expo-notifications";

let foregroundHandlerInstalled = false;

/**
 * The single place that sets the app's foreground presentation policy.
 * Every notification module calls this instead of `setNotificationHandler`,
 * so the handler is installed once regardless of import order.
 */
export function ensureForegroundNotificationHandler(): void {
  if (foregroundHandlerInstalled) return;
  foregroundHandlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
