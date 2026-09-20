import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";
import { useCallback, useEffect, useRef } from "react";
import { GACHA_REVEAL_SOUND_TIMING } from "@/features/draw/gacha-reveal-sound";

const LEVER_SOUND = require("../../../assets/draw/gacha/sfx/gacha-lever-ratchet.wav");
const DROP_SOUND = require("../../../assets/draw/gacha/sfx/gacha-capsule-drop.wav");
const OPEN_SOUND = require("../../../assets/draw/gacha/sfx/gacha-capsule-open.wav");

async function replay(player: AudioPlayer, enabledRef: { current: boolean }) {
  if (!enabledRef.current) return;
  try {
    await player.seekTo(0);
    if (enabledRef.current) player.play();
  } catch {
    // Audio feedback must never block or fail a committed draw presentation.
  }
}

export function useGachaRevealAudio(enabled: boolean) {
  const leverPlayer = useAudioPlayer(LEVER_SOUND, { downloadFirst: true, updateInterval: 1_000 });
  const dropPlayer = useAudioPlayer(DROP_SOUND, { downloadFirst: true, updateInterval: 1_000 });
  const openPlayer = useAudioPlayer(OPEN_SOUND, { downloadFirst: true, updateInterval: 1_000 });
  const enabledRef = useRef(enabled);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  enabledRef.current = enabled;

  useEffect(() => {
    void setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    leverPlayer.volume = 0.58;
    dropPlayer.volume = 0.46;
    openPlayer.volume = 0.7;
    leverPlayer.muted = !enabled;
    dropPlayer.muted = !enabled;
    openPlayer.muted = !enabled;
  }, [dropPlayer, enabled, leverPlayer, openPlayer]);

  const cancelScheduled = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const playLever = useCallback(() => {
    void replay(leverPlayer, enabledRef);
  }, [leverPlayer]);

  const scheduleDispense = useCallback(() => {
    cancelScheduled();
    timersRef.current = [
      setTimeout(() => void replay(dropPlayer, enabledRef), GACHA_REVEAL_SOUND_TIMING.dropImpactMs),
      setTimeout(() => void replay(openPlayer, enabledRef), GACHA_REVEAL_SOUND_TIMING.seamOpenMs),
    ];
  }, [cancelScheduled, dropPlayer, openPlayer]);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  return { cancelScheduled, playLever, scheduleDispense };
}
