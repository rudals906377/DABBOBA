import type { components } from "@dabboba/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  demoPaymentActionsForStatus,
  sessionStillCurrent,
  transitionDemoPayment,
  type DemoPaymentAction,
} from "@/features/demo/demo-api";
import { useDemoPaymentAvailability } from "@/features/demo/useDemoPaymentAvailability";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type CheckoutOrder = components["schemas"]["Order"];

const ACTION_LABELS: Record<DemoPaymentAction, string> = {
  approve: "승인 처리",
  fail: "실패 처리",
  cancel: "주문 취소",
  refund: "환불 처리",
};

export function DemoPaymentControls({
  surface,
  apiBaseUrl,
  orderId,
  orderStatus,
  onOrderChanged,
}: {
  surface: "internal-commerce";
  apiBaseUrl: string;
  orderId: string;
  orderStatus: CheckoutOrder["status"];
  onOrderChanged: (order: CheckoutOrder, accessToken: string) => void | Promise<void>;
}) {
  const enabled = useDemoPaymentAvailability(apiBaseUrl);
  const [busy, setBusy] = useState<DemoPaymentAction | null>(null);
  const [message, setMessage] = useState("");
  const focusedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const actionLockRef = useRef(false);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    actionLockRef.current = false;
    setBusy(null);
    setMessage("");
    return () => {
      focusedRef.current = false;
      requestGenerationRef.current += 1;
      actionLockRef.current = false;
    };
  }, [orderId]));

  if (surface !== "internal-commerce" || !__DEV__ || !enabled) return null;
  const actions = demoPaymentActionsForStatus(orderStatus);
  if (!actions.length) return null;

  const transition = async (action: DemoPaymentAction) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    const generation = ++requestGenerationRef.current;
    const isCurrent = () => focusedRef.current && requestGenerationRef.current === generation;
    setBusy(action);
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("주문을 처리하려면 다시 로그인해 주세요.");
      const currentOrder = await transitionDemoPayment(
        apiBaseUrl,
        tokens.accessToken,
        orderId,
        action,
      );
      if (!isCurrent() || !(await sessionStillCurrent(tokens.accessToken))) return;
      if (currentOrder.id !== orderId) throw new Error("현재 주문을 안전하게 다시 확인하지 못했습니다.");
      await onOrderChanged(currentOrder, tokens.accessToken);
    } catch (error) {
      if (isCurrent()) {
        setMessage(error instanceof Error ? error.message : "주문 상태를 바꾸지 못했습니다.");
      }
    } finally {
      if (isCurrent()) {
        actionLockRef.current = false;
        setBusy(null);
      }
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>TEST_PG · 실제 과금 없음</Text>
      <Text style={styles.body}>실제 서버 주문의 상태만 바꾸며 카드나 간편결제 정보는 받지 않아요.</Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityState={{ busy: busy === action, disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => void transition(action)}
            style={({ pressed }) => [
              styles.button,
              action !== "approve" && styles.secondaryButton,
              pressed && styles.pressed,
              busy !== null && styles.disabled,
            ]}
          >
            {busy === action ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={styles.buttonLabel}>{ACTION_LABELS[action]}</Text>
            )}
          </Pressable>
        ))}
      </View>
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: seed.radius.r4,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    padding: seed.spacing.x4,
    marginTop: seed.spacing.x3,
    backgroundColor: seed.color.layer.default,
  },
  title: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: seed.spacing.x2, marginTop: seed.spacing.x3 },
  button: {
    minHeight: seed.size.touchTarget,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: seed.radius.r3,
    paddingHorizontal: seed.spacing.x3,
    backgroundColor: seed.color.background.brandSolid,
  },
  secondaryButton: { backgroundColor: seed.color.layer.default },
  buttonLabel: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  message: { color: seed.color.foreground.critical, fontSize: 12, lineHeight: 18, marginTop: 8 },
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
});
