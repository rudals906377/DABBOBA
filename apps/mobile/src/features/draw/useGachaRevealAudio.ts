import { useCallback } from "react";
import { useDrawRevealFeedback } from "@/features/draw/useDrawRevealFeedback";

export function useGachaRevealAudio(soundEnabled: boolean, hapticsEnabled = false, sourceRun?: { value: number }) {
  const feedback = useDrawRevealFeedback("gacha", soundEnabled, hapticsEnabled);
  const playLever = useCallback((run = 0) => {
    if (sourceRun && sourceRun.value !== run) return;
    feedback.begin(run);
    void feedback.emit("primary", run);
  }, [feedback, sourceRun]);
  const scheduleDispense = useCallback((run = 0) => feedback.begin(run), [feedback]);
  const playDropImpact = useCallback((run = 0) => { void feedback.emit("secondary", run); }, [feedback]);
  const playRebound = useCallback((run = 0) => { void feedback.emit("rebound", run); }, [feedback]);
  const playSeamOpen = useCallback((run = 0) => { void feedback.emit("tertiary", run); }, [feedback]);
  return { cancelScheduled: feedback.cancel, playLever, scheduleDispense, playDropImpact, playRebound, playSeamOpen };
}
