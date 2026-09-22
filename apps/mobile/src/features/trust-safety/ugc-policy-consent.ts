import { Alert } from "react-native";
import {
  acceptUgcOperationsPolicy,
  fetchUgcOperationsPolicyAcceptance,
} from "./trust-safety-api";

export async function ensureUgcOperationsPolicyAcceptance(input: {
  apiBaseUrl: string;
  accessToken: string;
  openPolicy: () => void;
}): Promise<boolean> {
  const current = await fetchUgcOperationsPolicyAcceptance(input.apiBaseUrl, input.accessToken);
  if (current.accepted) return true;

  const agreed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(
      "운영정책 동의",
      "안전한 교환·신청·덕룸 이용을 위해 외부 결제 유도, 개인정보 공유, 허위 등록, 도배와 권리 침해를 금지합니다. 신고·차단 및 운영자 조치 기준에 동의해야 콘텐츠를 작성할 수 있어요.",
      [
        { text: "취소", style: "cancel", onPress: () => finish(false) },
        {
          text: "정책 보기",
          onPress: () => {
            input.openPolicy();
            finish(false);
          },
        },
        { text: "동의하고 계속", onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
  if (!agreed) return false;
  await acceptUgcOperationsPolicy(input.apiBaseUrl, input.accessToken, current.policyVersion);
  return true;
}
