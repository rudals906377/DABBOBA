import { useCallback } from "react";
import { useAudioPlayer } from "expo-audio";
import { useDrawRevealFeedback } from "@/features/draw/useDrawRevealFeedback";

export function useGachaRevealAudio(soundEnabled: boolean, hapticsEnabled = false, sourceRun?: { value: number }) {
  const coin = useAudioPlayer(require("../../../assets/draw/gacha/sfx/gacha-coin-drop.wav"), { downloadFirst: true, updateInterval: 1_000 });
  const chamber = useAudioPlayer(require("../../../assets/draw/gacha/sfx/gacha-capsules-rattle.wav"), { downloadFirst: true, updateInterval: 1_000 });
  const feedback = useDrawRevealFeedback("gacha", soundEnabled, hapticsEnabled, { coin, chamber });
  const playCoin = useCallback((run: number) => {
    if (sourceRun && sourceRun.value !== run) return;
    feedback.begin(run);
    void feedback.emit("coin", run);
  }, [feedback, sourceRun]);
  const playChamber = useCallback((run: number, occurrence: number) => {
    if (sourceRun && sourceRun.value !== run) return;
    feedback.begin(run);
    void feedback.emit("chamber", run, occurrence);
  }, [feedback, sourceRun]);
  const playLever = useCallback((run = 0, occurrence = 0) => {
    if (sourceRun && sourceRun.value !== run) return;
    feedback.begin(run);
    void feedback.emit("primary", run, occurrence);
  }, [feedback, sourceRun]);
  const scheduleDispense = useCallback((run = 0) => feedback.begin(run), [feedback]);
  const playDropImpact = useCallback((run = 0) => { void feedback.emit("secondary", run); }, [feedback]);
  const playRebound = useCallback((run = 0) => { void feedback.emit("rebound", run); }, [feedback]);
  const playSeamOpen = useCallback((run = 0) => { void feedback.emit("tertiary", run); }, [feedback]);
  return { cancelScheduled: feedback.cancel, playCoin, playChamber, playLever, scheduleDispense, playDropImpact, playRebound, playSeamOpen };
}
