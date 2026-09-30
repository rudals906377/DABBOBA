import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";
import { useCallback, useEffect, useRef } from "react";

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
  // The native reveal timeline fires each cue at its matching progress; this
  // arming state lets cancel (reset, SKIP, settle, unmount) silence cues that
  // are already on their way from the UI thread.
  const cuesRef = useRef({ armed: false, dropPlayed: false, openPlayed: false });

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
    cuesRef.current = { armed: false, dropPlayed: false, openPlayed: false };
  }, []);

  const playLever = useCallback(() => {
    void replay(leverPlayer, enabledRef);
  }, [leverPlayer]);

  const scheduleDispense = useCallback(() => {
    cuesRef.current = { armed: true, dropPlayed: false, openPlayed: false };
  }, []);

  const playDropImpact = useCallback(() => {
    const cues = cuesRef.current;
    if (!cues.armed || cues.dropPlayed) return;
    cues.dropPlayed = true;
    void replay(dropPlayer, enabledRef);
  }, [dropPlayer]);

  const playSeamOpen = useCallback(() => {
    const cues = cuesRef.current;
    if (!cues.armed || cues.openPlayed) return;
    cues.openPlayed = true;
    void replay(openPlayer, enabledRef);
  }, [openPlayer]);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  return { cancelScheduled, playDropImpact, playLever, playSeamOpen, scheduleDispense };
}
