import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { AppState, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createDrawFeedbackController, type DrawFeedbackCue } from "@/features/draw/draw-feedback-controller";

const SOURCES = {
  gacha: [
    require("../../../assets/draw/gacha/sfx/gacha-lever-ratchet.wav"),
    require("../../../assets/draw/gacha/sfx/gacha-capsule-drop.wav"),
    require("../../../assets/draw/gacha/sfx/gacha-capsule-open.wav"),
  ],
  kuji: [
    require("../../../assets/draw/kuji/sfx/kuji-paper-peel.wav"),
    require("../../../assets/draw/kuji/sfx/kuji-paper-tear.wav"),
    require("../../../assets/draw/kuji/sfx/kuji-paper-release.wav"),
  ],
} as const;

export function useDrawRevealFeedback(category: "gacha" | "kuji", sound: boolean, haptics: boolean,
  extras: Partial<Record<"coin" | "chamber" | "flutter", ReturnType<typeof useAudioPlayer>>> = {}) {
  const { coin, chamber, flutter } = extras;
  const primary = useAudioPlayer(SOURCES[category][0], { downloadFirst: true, updateInterval: 1_000 });
  const secondary = useAudioPlayer(SOURCES[category][1], { downloadFirst: true, updateInterval: 1_000 });
  const tertiary = useAudioPlayer(SOURCES[category][2], { downloadFirst: true, updateInterval: 1_000 });
  const preferences = useRef({ sound, haptics });
  preferences.current = { sound, haptics };
  const foreground = useRef(AppState.currentState === "active");
  const focused = useRef(false);
  const audioModeReady = useRef(false);
  const controller = useMemo(() => createDrawFeedbackController(
    { primary, secondary, tertiary, coin, chamber, flutter },
    () => ({ ...preferences.current, sound: preferences.current.sound && audioModeReady.current,
      foreground: foreground.current && focused.current }),
    (cue: DrawFeedbackCue, occurrence: number) => {
      if (cue === "coin" || cue === "chamber") return Promise.resolve();
      if (cue === "flutter" || (category === "kuji" && occurrence > 0)) return Promise.resolve();
      if (Platform.OS === "android") {
        const contact = category === "gacha" ? cue === "secondary" : cue === "tertiary";
        return Haptics.performAndroidHapticsAsync(contact ? Haptics.AndroidHaptics.Context_Click : Haptics.AndroidHaptics.Segment_Frequent_Tick);
      }
      if ((category === "gacha" && cue === "primary") || (category === "kuji" && cue === "secondary")) return Haptics.selectionAsync();
      const light = category === "gacha" ? cue === "secondary" : cue === "tertiary";
      return Haptics.impactAsync(light ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft);
    },
  ), [category, primary, secondary, tertiary, coin, chamber, flutter]);
  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: false, interruptionMode: "mixWithOthers", playsInSilentMode: false,
      shouldPlayInBackground: false, shouldRouteThroughEarpiece: false })
      .then(() => { audioModeReady.current = true; }).catch(() => undefined);
    return () => { audioModeReady.current = false; };
  }, []);
  useEffect(() => {
    const volumes = category === "gacha" ? [0.5, 0.45, 0.5, 0.35, 0.22, 0] : [0.44, 0.5, 0.35, 0, 0, 0.16];
    [primary, secondary, tertiary, coin, chamber, flutter].forEach((player, index) => {
      if (!player) return;
      try { player.volume = volumes[index]!; player.muted = !sound; } catch { /* Optional native audio may already be released. */ }
    });
    if (!sound) controller.stopSound();
  }, [category, controller, primary, secondary, sound, tertiary, coin, chamber, flutter]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; controller.cancel(); };
  }, [controller]));
  useEffect(() => {
    foreground.current = AppState.currentState === "active";
    const subscription = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (!foreground.current) controller.cancel();
    });
    return () => { foreground.current = false; subscription.remove(); controller.cancel(); };
  }, [controller]);
  return controller;
}
