export type DrawFeedbackCue = "primary" | "secondary" | "tertiary" | "rebound";
export type DrawFeedbackPlayer = { seekTo: (seconds: number) => Promise<void>; play: () => void; pause: () => void };
export type DrawFeedbackOptions = { sound: boolean; haptics: boolean; foreground: boolean };

/** Native players/haptics are optional feedback, never part of the result gate. */
export function createDrawFeedbackController(
  players: Partial<Record<DrawFeedbackCue, DrawFeedbackPlayer>>,
  options: () => DrawFeedbackOptions,
  haptic: (cue: DrawFeedbackCue) => Promise<void>,
) {
  let run: number | null = null;
  let generation = 0;
  let latestRun = -1;
  const played = new Map<DrawFeedbackCue, number>();
  const seeks = new Map<DrawFeedbackCue, number>();
  const stopSound = () => {
    generation += 1;
    for (const player of Object.values(players)) {
      try { player?.pause(); } catch { /* A released native player is already silent. */ }
    }
  };
  const cancel = () => { stopSound(); run = null; played.clear(); };
  const begin = (nextRun: number) => {
    if (!options().foreground || !Number.isSafeInteger(nextRun) || nextRun < 0 || nextRun < latestRun) return;
    if (run === nextRun) return;
    cancel();
    latestRun = nextRun;
    run = nextRun;
  };
  const emit = async (cue: DrawFeedbackCue, cueRun: number, occurrence = 0) => {
    const allowed = options();
    if (!allowed.foreground || run !== cueRun || !Number.isSafeInteger(occurrence) || occurrence < 0
      || occurrence <= (played.get(cue) ?? -1)) return;
    played.set(cue, occurrence);
    if (allowed.haptics) {
      try { void haptic(cue).catch(() => undefined); } catch { /* Unsupported haptics are optional. */ }
    }
    const player = players[cue];
    if (!allowed.sound || !player) return;
    const ticket = generation;
    const seek = (seeks.get(cue) ?? 0) + 1;
    seeks.set(cue, seek);
    try {
      player.pause();
      await player.seekTo(0);
      const current = options();
      if (ticket === generation && seek === seeks.get(cue) && run === cueRun && current.foreground && current.sound) player.play();
    } catch { /* Audio feedback must never block or fail a committed draw presentation. */ }
  };
  return { begin, emit, cancel, stopSound };
}
