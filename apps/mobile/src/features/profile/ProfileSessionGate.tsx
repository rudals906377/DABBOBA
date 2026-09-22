import { router, type Href } from "expo-router";
import { StyleSheet, View } from "react-native";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import type { ProfileSessionStatus } from "@/features/profile/profile-session-state";
import { colors } from "@/theme";

export function ProfileSessionGate({
  status,
  returnTo,
  guestBody = "로그인하면 내 계정의 정보를 확인할 수 있어요.",
}: {
  status: Extract<ProfileSessionStatus, "guest" | "expired">;
  returnTo: string;
  guestBody?: string;
}) {
  const expired = status === "expired";
  return (
    <View style={styles.container}>
      <KoreanPixelTitle variant="section">
        {expired ? "로그인이 만료됐어요" : "로그인이 필요해요"}
      </KoreanPixelTitle>
      <Text style={styles.body}>
        {expired ? "계속하려면 다시 로그인해 주세요." : guestBody}
      </Text>
      <SeedActionButton
        label={expired ? "다시 로그인" : "로그인"}
        onPress={() => router.push({ pathname: "/auth/login", params: { returnTo } } as Href)}
        style={styles.button}
      />
    </View>
  );
}

export function isProfileSessionBlocked(
  status: ProfileSessionStatus,
): status is "guest" | "expired" {
  return status === "guest" || status === "expired";
}

const styles = StyleSheet.create({
  container: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x5,
  },
  body: {
    marginTop: seed.spacing.x2,
    color: colors.muted,
    ...seed.typography.body,
    textAlign: "center",
  },
  button: { alignSelf: "stretch", marginTop: seed.spacing.x4 },
});
