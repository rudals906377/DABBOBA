import { useAudioPlayer } from "expo-audio";
import { useDrawRevealFeedback } from "@/features/draw/useDrawRevealFeedback";

export function useKujiRevealAudio(sound: boolean, haptics: boolean) {
  const flutter = useAudioPlayer(require("../../../assets/draw/kuji/sfx/kuji-paper-flutter.wav"),
    { downloadFirst: true, updateInterval: 1_000 });
  return useDrawRevealFeedback("kuji", sound, haptics, { flutter });
}
