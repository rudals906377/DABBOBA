import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { SeedActionButton, SeedCard } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { presentDrawOpenModeChoice } from "@/features/draw/draw-open-mode-prompt";
import { drawEntitlementCountFromPath, withDrawOpenMode } from "@/features/draw/draw-open-mode";
import { createPaidDrawRecoverySource } from "@/features/profile/paid-draw-recovery-api";
import {
  groupAvailableDrawEntitlements,
  preparePaidDrawRecovery,
  type AvailableDrawEntitlement,
  type PaidDrawRecoveryGroup,
} from "@/features/profile/paid-draw-recovery-state";
import { categoryLabel, formatDate } from "@/features/profile/profile-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";

export function PaidDrawRecovery({
  apiBaseUrl, actorId, refreshKey, catalogProducts, ipNames,
}: {
  apiBaseUrl: string;
  actorId: string;
  refreshKey: string;
  catalogProducts: CatalogProduct[];
  ipNames: Record<string, string>;
}) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const workingRef = useRef(false);
  const [items, setItems] = useState<AvailableDrawEntitlement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveringKey, setRecoveringKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const groups = useMemo(() => groupAvailableDrawEntitlements(items), [items]);

  const sourceForSession = useCallback(async (signal: AbortSignal) => {
    const tokens = await readAuthTokens();
    if (!tokens?.accessToken) throw new Error("로그인 후 남은 추첨권을 확인해 주세요.");
    if (signal.aborted) throw new Error("추첨권 확인이 취소됐어요.");
    return { source: createPaidDrawRecoverySource(apiBaseUrl, tokens.accessToken, signal), accessToken: tokens.accessToken };
  }, [apiBaseUrl]);

  const loadPage = useCallback(async (controller: AbortController, nextCursor?: string) => {
    workingRef.current = true;
    setLoading(true);
    setMessage("");
    try {
      const { source, accessToken } = await sourceForSession(controller.signal);
      if (await source.fetchActorId() !== actorId) {
        if (!controller.signal.aborted) {
          setItems([]);
          setCursor(null);
        }
        throw new Error("로그인 계정이 변경됐어요. 구매 내역을 다시 불러와 주세요.");
      }
      const page = await source.fetchPage(nextCursor);
      const currentTokens = await readAuthTokens();
      if (controller.signal.aborted) return;
      if (currentTokens?.accessToken !== accessToken) {
        setItems([]);
        setCursor(null);
        throw new Error("로그인 정보가 변경됐어요. 구매 내역을 다시 불러와 주세요.");
      }
      if (nextCursor && page.nextCursor === nextCursor) throw new Error("추첨권 목록을 더 불러오지 못했어요.");
      setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "남은 추첨권을 불러오지 못했어요.");
    } finally {
      if (!controller.signal.aborted) {
        workingRef.current = false;
        setLoading(false);
      }
    }
  }, [actorId, sourceForSession]);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setItems([]);
    setCursor(null);
    setRecoveringKey(null);
    void loadPage(controller);
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [loadPage, refreshKey]));

  const resume = async (group: PaidDrawRecoveryGroup) => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted || workingRef.current) return;
    workingRef.current = true;
    setRecoveringKey(group.key);
    setMessage("");
    try {
      const { source, accessToken } = await sourceForSession(controller.signal);
      const route = await preparePaidDrawRecovery(group, actorId, source, controller.signal);
      const currentTokens = await readAuthTokens();
      if (controller.signal.aborted) return;
      if (currentTokens?.accessToken !== accessToken) throw new Error("로그인 정보가 변경됐어요. 구매 내역을 다시 불러와 주세요.");
      if (route.startsWith("/draw/reveal/")) {
        presentDrawOpenModeChoice(drawEntitlementCountFromPath(route), (mode) => {
          if (!controller.signal.aborted) router.push(withDrawOpenMode(route, mode) as Href);
        });
      } else {
        router.push(route as Href);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "이어 뽑기를 시작하지 못했어요.");
    } finally {
      if (!controller.signal.aborted) {
        workingRef.current = false;
        setRecoveringKey(null);
      }
    }
  };

  const reload = () => {
    const controller = controllerRef.current;
    if (controller && !controller.signal.aborted && !workingRef.current) void loadPage(controller);
  };

  if (!loading && !message && groups.length === 0 && !cursor) return null;
  return (
    <View style={styles.section}>
      <KoreanPixelTitle variant="section">남은 뽑기</KoreanPixelTitle>
      {groups.map((group) => {
        const product = catalogProducts.find((candidate) => candidate.id === group.product.id);
        const ipName = product ? ipNames[product.ipId] : undefined;
        return (
          <SeedCard key={group.key} style={styles.card}>
            {ipName ? <Text style={styles.metadata}>{ipName}</Text> : null}
            <Text style={styles.productName}>{productSubjectTitle(group.product.name, ipName ?? "")}</Text>
            <ProductInfoDivider />
            <Text style={styles.metadata}>{formatDate(group.createdAt)} · {categoryLabel(group.product.category)}</Text>
            <SeedActionButton
              label="이어 뽑기"
              loading={recoveringKey === group.key}
              disabled={loading || recoveringKey !== null}
              onPress={() => void resume(group)}
            />
          </SeedCard>
        );
      })}
      {loading ? <ActivityIndicator accessibilityLabel="남은 추첨권 확인 중" color={seed.color.foreground.neutral} /> : null}
      {message ? (
        <View style={styles.error}>
          <BalancedAppText accessibilityRole="alert" style={styles.errorText}>{message}</BalancedAppText>
          <SeedActionButton label="다시 확인" variant="neutralWeak" disabled={loading || recoveringKey !== null} onPress={reload} />
        </View>
      ) : null}
      {cursor ? (
        <SeedActionButton
          label="남은 뽑기 더 보기"
          variant="neutralWeak"
          disabled={loading || recoveringKey !== null}
          onPress={() => {
            const controller = controllerRef.current;
            if (controller && !controller.signal.aborted && !workingRef.current) void loadPage(controller, cursor);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: seed.spacing.x3, marginBottom: seed.spacing.x5 },
  card: { gap: seed.spacing.x3 },
  productName: { ...seed.typography.bodyStrong, color: seed.color.foreground.neutral },
  metadata: { ...seed.typography.caption, color: seed.color.foreground.muted },
  error: { gap: seed.spacing.x3 },
  errorText: { ...seed.typography.caption, color: seed.color.foreground.critical },
});
