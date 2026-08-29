import { Image, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

const WORDMARK = require("../../assets/dabboba-wordmark.png");

type MigrationScreenProps = {
  title: string;
  description: string;
};

export function MigrationScreen({ title, description }: MigrationScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Image source={WORDMARK} resizeMode="contain" style={styles.wordmark} />
        <View style={styles.card}>
          <KoreanPixelTitle variant="hero">{title}</KoreanPixelTitle>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.status}>
            <View style={styles.dot} />
            <Text style={styles.statusLabel}>APP-FIRST MIGRATION</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { flexGrow: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.navToTitle, paddingBottom: seed.spacing.x8 },
  wordmark: { width: 136, height: 20, alignSelf: "flex-start", marginBottom: 32 },
  card: {
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    borderRadius: seed.radius.r6,
    backgroundColor: seed.color.layer.default,
    padding: seed.spacing.x6,
  },
  description: { color: seed.color.foreground.muted, ...seed.typography.articleBody, marginTop: seed.spacing.x3_5 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand },
  statusLabel: { color: colors.ink, fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
});
