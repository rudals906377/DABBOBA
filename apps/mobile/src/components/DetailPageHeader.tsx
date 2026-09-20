import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle, ReadablePageTitle } from "@/components/RootCategoryTitle";
import { SeedIconButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";

export type DetailPageHeaderTitleMode = "readable" | "pixel";

export type DetailPageHeaderProps = {
  title: string;
  onBack: () => void;
  backLabel?: string;
  titleMode?: DetailPageHeaderTitleMode;
  titleNumberOfLines?: 1 | 2;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
};

/**
 * Shared 60pt detail header with equal 44pt edge columns.
 * Use `readable` for user or admin-authored titles and `pixel` for short fixed labels.
 */
export function DetailPageHeader({
  title,
  onBack,
  backLabel = "뒤로 가기",
  titleMode = "readable",
  titleNumberOfLines,
  action,
  style,
  titleStyle,
}: DetailPageHeaderProps) {
  const resolvedTitleNumberOfLines = titleNumberOfLines ?? (titleMode === "readable" ? 2 : 1);
  return (
    <View style={[styles.header, style]}>
      <View style={styles.edgeSlot}>
        <SeedIconButton label={backLabel} onPress={onBack}>
          <DecorativeIonicon name="chevron-back" size={24} color={seed.color.foreground.neutral} />
        </SeedIconButton>
      </View>
      <View style={styles.titleSlot}>
        {titleMode === "pixel" ? (
          <KoreanPixelTitle variant="header" numberOfLines={resolvedTitleNumberOfLines} style={titleStyle}>
            {title}
          </KoreanPixelTitle>
        ) : (
          <ReadablePageTitle variant="subheading" numberOfLines={resolvedTitleNumberOfLines} style={titleStyle}>
            {title}
          </ReadablePageTitle>
        )}
      </View>
      <View style={styles.edgeSlot}>{action}</View>
    </View>
  );
}

export function DetailPageHeaderAction({
  label,
  onPress,
  children,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <SeedIconButton label={label} disabled={disabled} onPress={onPress}>
      {children}
    </SeedIconButton>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: seed.size.topNavigation,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.basement,
  },
  edgeSlot: {
    width: seed.size.touchTarget,
    minHeight: seed.size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  titleSlot: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x2,
  },
});
