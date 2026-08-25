import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme";

const WORDMARK = require("../../assets/dabboba-wordmark.png");

type MigrationScreenProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function MigrationScreen({ eyebrow, title, description }: MigrationScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Image source={WORDMARK} resizeMode="contain" style={styles.wordmark} />
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
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
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 32 },
  wordmark: { width: 136, height: 20, alignSelf: "flex-start", marginBottom: 32 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 24,
    backgroundColor: colors.surface,
    padding: 24,
  },
  eyebrow: {
    color: colors.greenInk,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  title: { color: colors.ink, fontSize: 30, lineHeight: 38, fontWeight: "900" },
  description: { color: colors.muted, fontSize: 16, lineHeight: 25, marginTop: 14 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand },
  statusLabel: { color: colors.ink, fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
});
