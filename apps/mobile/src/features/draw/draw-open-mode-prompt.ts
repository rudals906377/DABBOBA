import { Alert } from "react-native";
import {
  resolveDrawOpenModeDecision,
  type DrawOpenMode,
} from "@/features/draw/draw-open-mode";

export function presentDrawOpenModeChoice(
  count: number,
  onSelect: (mode: DrawOpenMode) => void,
): void {
  const decision = resolveDrawOpenModeDecision(count);
  if (decision.kind === "direct") {
    onSelect(decision.mode);
    return;
  }

  Alert.alert(
    "뽑기 방식 선택",
    `${decision.count}개를 한 번에 확인하거나 하나씩 열 수 있어요.`,
    [
      { text: "하나씩 뽑기", onPress: () => onSelect("single") },
      { text: "한 번에 뽑기", onPress: () => onSelect("all") },
    ],
    { cancelable: false },
  );
}
