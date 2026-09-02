import { router, type Href } from "expo-router";
import { Alert } from "react-native";

const DEFAULT_AFTER_LOGIN = "/(tabs)/profile" as Href;

export function resolveAfterLoginPath(value: string | string[] | undefined): Href {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate
    || candidate.length > 300
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.startsWith("/auth/")
    || /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return DEFAULT_AFTER_LOGIN;
  }
  return candidate as Href;
}

export function openCustomerLogin(message: string, returnTo: string): void {
  Alert.alert("로그인이 필요해요", message, [
    { text: "취소", style: "cancel" },
    {
      text: "로그인",
      onPress: () => router.push({ pathname: "/auth/login", params: { returnTo } } as Href),
    },
  ]);
}
