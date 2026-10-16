import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton, SeedChip } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { GachaLeverMachine } from "@/features/draw/GachaLeverMachine";
import { KujiPeelTicket } from "@/features/draw/KujiPeelTicket";
import { colors } from "@/theme";

/** Offline presentation check: no commerce API, account, catalog or award. */
export function DrawAnimationCheckScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [category, setCategory] = useState<"kuji" | "gacha">("kuji");
  const [run, setRun] = useState(0);
  const [requestSignal, setRequestSignal] = useState(0);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const reset = (nextCategory = category) => {
    setCategory(nextCategory);
    setRun((value) => value + 1);
    setRequestSignal(0);
    setReady(false);
    setSettled(false);
  };
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>애니메이션 확인</Text>
        <SeedActionButton label="닫기" variant="neutralWeak" size="small" onPress={() => router.replace("/(tabs)")} />
      </View>
      <Text style={styles.notice}>개발 전용 · 구매 및 상품 지급 없음</Text>
      <View style={styles.tabs}>
        <SeedChip label="쿠지" selected={category === "kuji"} onPress={() => reset("kuji")} />
        <SeedChip label="가챠" selected={category === "gacha"} onPress={() => reset("gacha")} />
      </View>
      <View style={styles.tabs}>
        <SeedChip label={soundEnabled ? "소리 켬" : "소리 끔"} selected={soundEnabled} onPress={() => setSoundEnabled((value) => !value)} />
        <SeedChip label={hapticsEnabled ? "진동 켬" : "진동 끔"} selected={hapticsEnabled} onPress={() => setHapticsEnabled((value) => !value)} />
      </View>
      <View style={styles.stage}>
        {category === "kuji" ? (
          <KujiPeelTicket
            key={`kuji:${run}`}
            ticketNumber="17"
            reduceMotion={reduceMotion}
            soundEnabled={soundEnabled}
            hapticsEnabled={hapticsEnabled}
            resultReady={ready}
            requestSignal={requestSignal}
            settled={settled}
            onRequestOpen={() => setReady(true)}
            onRevealSettled={() => setSettled(true)}
            resultLabel="확인"
            resultTitle="애니메이션 확인용"
            resultContent={<Text style={styles.result}>종이 열기 완료</Text>}
          />
        ) : (
          <GachaLeverMachine
            key={`gacha:${run}`}
            reduceMotion={reduceMotion}
            soundEnabled={soundEnabled}
            hapticsEnabled={hapticsEnabled}
            resultReady={ready}
            requestSignal={requestSignal}
            settled={settled}
            onRequestOpen={() => setReady(true)}
            onRevealSettled={() => setSettled(true)}
            prize={{ result: null, previewLabel: "RESULT 01" }}
          />
        )}
      </View>
      <Text style={styles.hint}>
        {settled ? "다시 보기를 눌러 반복해서 확인하세요" : category === "kuji" ? "종이를 오른쪽으로 밀어보세요" : "레버를 6번 누르거나 시계 방향으로 돌려보세요"}
      </Text>
      <View style={styles.actions}>
        <SeedActionButton label="다시 보기" variant="neutralWeak" style={styles.action} onPress={() => reset()} />
        <SeedActionButton label="재생" style={styles.action} disabled={ready} onPress={() => setRequestSignal((value) => value + 1)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: seed.spacing.x4, paddingTop: seed.spacing.x2 },
  title: { color: colors.white, fontSize: 18, fontWeight: "700" },
  notice: { color: colors.line, fontSize: 12, paddingHorizontal: seed.spacing.x4, marginTop: seed.spacing.x2 },
  tabs: { flexDirection: "row", gap: seed.spacing.x2, paddingHorizontal: seed.spacing.x4, marginTop: seed.spacing.x3 },
  stage: { flex: 1, minHeight: 432, alignItems: "center", justifyContent: "center" },
  result: { color: colors.white, fontSize: 22, textAlign: "center" },
  hint: { color: colors.line, fontSize: 12, textAlign: "center", marginBottom: seed.spacing.x3 },
  actions: { flexDirection: "row", gap: seed.spacing.x2, paddingHorizontal: seed.spacing.x4, paddingBottom: seed.spacing.x3 },
  action: { flex: 1 },
});
