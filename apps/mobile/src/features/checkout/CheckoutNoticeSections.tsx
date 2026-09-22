import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { toggleCheckoutNoticeState } from "@/features/checkout/checkout-payment-ui";
import {
  CHECKOUT_NOTICE_SECTIONS,
  type CheckoutNoticeSection,
} from "@/features/checkout/checkout-reference-notices";
import { colors } from "@/theme";

export function CheckoutNoticeSections({
  sections = CHECKOUT_NOTICE_SECTIONS,
}: {
  sections?: readonly CheckoutNoticeSection[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <View style={styles.list}>
      {sections.map((section) => {
        const open = Boolean(expanded[section.id]);
        return (
          <View key={section.id} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${section.title} ${open ? "접기" : "펼치기"}`}
              onPress={() => setExpanded((current) => toggleCheckoutNoticeState(current, section.id))}
              style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
            >
              <Text style={styles.title}>{section.title}</Text>
              <DecorativeIonicon name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
            </Pressable>
            {open ? (
              <View style={styles.body}>
                {section.groups.map((group, groupIndex) => (
                  <View key={`${section.id}-${group.title ?? groupIndex}`} style={styles.group}>
                    {group.title ? <Text style={styles.groupTitle}>{group.title}</Text> : null}
                    {group.items.map((item, itemIndex) => (
                      <View key={`${section.id}-${groupIndex}-${itemIndex}`}>
                        <View style={styles.bulletRow}>
                          <Text aria-hidden style={styles.bullet}>•</Text>
                          <Text style={styles.copy}>{item.text}</Text>
                        </View>
                        {item.children?.map((child, childIndex) => (
                          <View key={`${section.id}-${groupIndex}-${itemIndex}-${childIndex}`} style={styles.nestedRow}>
                            <Text aria-hidden style={styles.nestedBullet}>•</Text>
                            <Text style={styles.copy}>{child}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: seed.spacing.x2 },
  section: { borderRadius: seed.radius.r3, overflow: "hidden", backgroundColor: seed.color.background.neutralWeak },
  trigger: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3, paddingVertical: seed.spacing.x2_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  title: { flex: 1, color: colors.ink, ...seed.typography.bodyStrong },
  body: { paddingHorizontal: seed.spacing.x3, paddingBottom: seed.spacing.x3, gap: seed.spacing.x3 },
  group: { gap: seed.spacing.x1_5 },
  groupTitle: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2 },
  nestedRow: { marginLeft: seed.spacing.x3, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2 },
  bullet: { color: colors.muted, ...seed.typography.caption },
  nestedBullet: { color: colors.muted, ...seed.typography.caption },
  copy: { flex: 1, color: colors.muted, ...seed.typography.caption },
  pressed: { opacity: seed.state.pressedOpacity },
});
