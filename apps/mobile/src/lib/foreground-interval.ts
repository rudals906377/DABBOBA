/**
 * Minimal AppState surface so the scheduler stays testable without React Native.
 */
export type AppStateLike = {
  currentState: string | null | undefined;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

type IntervalTimers = {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

const defaultTimers: IntervalTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** `background` and `inactive` pause polling; any other state (including an unknown launch state) runs it. */
export function isAppStateActive(state: string | null | undefined): boolean {
  return state !== "background" && state !== "inactive";
}

/**
 * Runs `onTick` every `intervalMs` only while the app is in the foreground.
 * The interval stops when the app leaves `active` and restarts on return; each
 * return to `active` also runs `onTick` once immediately (unless disabled) so
 * a paused refresh catches up without waiting a full interval.
 * Returns a cleanup that stops the interval and the AppState subscription.
 */
export function startForegroundInterval(
  appState: AppStateLike,
  onTick: () => void,
  intervalMs: number,
  options: { refreshOnForeground?: boolean; timers?: IntervalTimers } = {},
): () => void {
  const timers = options.timers ?? defaultTimers;
  const refreshOnForeground = options.refreshOnForeground ?? true;
  let handle: unknown = null;
  const start = () => {
    if (handle === null) handle = timers.setInterval(onTick, intervalMs);
  };
  const stop = () => {
    if (handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };
  if (isAppStateActive(appState.currentState)) start();
  const subscription = appState.addEventListener("change", (state) => {
    if (state === "active") {
      if (refreshOnForeground) onTick();
      start();
    } else if (!isAppStateActive(state)) {
      stop();
    }
  });
  return () => {
    stop();
    subscription.remove();
  };
}
