import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import type { CatalogIp, CatalogProduct } from "@dabboba/contracts";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton, SeedChip, SeedTextInput } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { useStorefrontCategoryOptions } from "@/features/catalog/StorefrontCategorySettingsProvider";
import {
  isCustomerProductCategoryComingSoon,
  productCategoryLabel,
} from "@/features/catalog/product-categories";
import {
  createWantedRequest,
  pickWantedRequestImage,
  searchWantedIps,
  uploadWantedRequestImage,
  type WantedRequestImage,
} from "@/features/profile/wanted-request-api";
import { findWantedIpSuggestions, resolveWantedIpSelection, type WantedIpOption } from "@/features/profile/wanted-request-ip";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { ensureUgcOperationsPolicyAcceptance } from "@/features/trust-safety/ugc-policy-consent";
import { colors } from "@/theme";

export function WantedRequestCreateScreen() {
  const categoryOptions = useStorefrontCategoryOptions("wanted");
  const profileState = useProfileSnapshot("request-compose");
  const snapshot = profileState.snapshot;
  const ipOptions = useMemo(
    () => Object.entries(snapshot?.ipNames ?? {}).map(([id, nameKo]): WantedIpOption => ({
      id,
      nameKo,
      nameEn: nameKo,
      nameJa: null,
      aliases: [],
    })),
    [snapshot?.ipNames],
  );
  const [category, setCategory] = useState<CatalogProduct["category"]>("gacha");
  const [ipQuery, setIpQuery] = useState("");
  const [selectedIp, setSelectedIp] = useState<Pick<WantedIpOption, "id" | "nameKo"> | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<CatalogIp[]>([]);
  const [desiredItem, setDesiredItem] = useState("");
  const [details, setDetails] = useState("");
  const [image, setImage] = useState<WantedRequestImage | null>(null);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchSequence = useRef(0);
  const hasFocusedOnce = useRef(false);
  const categoryComingSoon = isCustomerProductCategoryComingSoon(category);

  useEffect(() => {
    if (!categoryOptions.some((option) => option.value === category) && categoryOptions[0]) {
      setCategory(categoryOptions[0].value);
    }
  }, [category, categoryOptions]);
  const localSuggestions = useMemo(
    () => findWantedIpSuggestions(ipOptions, ipQuery),
    [ipOptions, ipQuery],
  );
  const suggestions = remoteSuggestions.length ? remoteSuggestions : localSuggestions;

  useFocusEffect(useCallback(() => {
    if (hasFocusedOnce.current) void profileState.reload();
    else hasFocusedOnce.current = true;
  }, [profileState.reload]));

  useEffect(() => {
    const query = ipQuery.trim();
    const sequence = ++searchSequence.current;
    if (!query || selectedIp?.nameKo === query) {
      setRemoteSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchWantedIps(profileState.runtime.apiBaseUrl, query)
        .then((items) => {
          if (sequence === searchSequence.current) setRemoteSuggestions(items);
        })
        .catch(() => {
          if (sequence === searchSequence.current) setRemoteSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [ipQuery, profileState.runtime.apiBaseUrl, selectedIp?.nameKo]);

  const changeIpQuery = (value: string) => {
    setIpQuery(value.slice(0, 160));
    setSelectedIp(null);
  };

  const chooseIp = (option: WantedIpOption) => {
    setIpQuery(option.nameKo);
    setSelectedIp({ id: option.id, nameKo: option.nameKo });
    setRemoteSuggestions([]);
  };

  const chooseImage = async () => {
    try {
      const next = await pickWantedRequestImage();
      if (!next) return;
      setImage(next);
      setUploadedMediaId(null);
    } catch (error) {
      Alert.alert("사진을 첨부하지 못했어요", error instanceof Error ? error.message : "다시 시도해 주세요.");
    }
  };

  const submit = async () => {
    if (categoryComingSoon) {
      Alert.alert(
        "준비중입니다.",
        `${productCategoryLabel(category)} 상품은 준비가 끝나는 대로 공개할게요.`,
      );
      return;
    }
    const item = desiredItem.trim();
    const description = details.trim();
    const work = selectedIp && selectedIp.nameKo === ipQuery.trim()
      ? { ipId: selectedIp.id, ipNameKo: selectedIp.nameKo }
      : resolveWantedIpSelection([...remoteSuggestions, ...ipOptions], ipQuery);
    if (!work.ipNameKo) {
      Alert.alert("작품 이름을 입력해 주세요");
      return;
    }
    if (!item) {
      Alert.alert("찾는 상품 이름을 입력해 주세요");
      return;
    }
    if (!description) {
      Alert.alert("상품을 찾는 이유나 특징을 입력해 주세요");
      return;
    }
    if (!snapshot || snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 신청방에 원하는 상품을 등록할 수 있어요.");
      return;
    }
    try {
      setSubmitting(true);
      const accepted = await ensureUgcOperationsPolicyAcceptance({
        apiBaseUrl: profileState.runtime.apiBaseUrl,
        accessToken: profileState.accessToken,
        openPolicy: () => router.push("/legal/exchange-request" as Href),
      });
      if (!accepted) return;
      let mediaId = uploadedMediaId;
      if (image && !mediaId) {
        mediaId = await uploadWantedRequestImage(
          profileState.runtime.apiBaseUrl,
          profileState.accessToken,
          image,
        );
        setUploadedMediaId(mediaId);
      }
      const created = await createWantedRequest(profileState.runtime.apiBaseUrl, profileState.accessToken, {
        category,
        ipId: work.ipId,
        ipNameKo: work.ipNameKo,
        desiredItem: item,
        details: description,
        mediaId,
      });
      await profileState.reload();
      router.replace(`/profile/requests/${encodeURIComponent(created.id)}`);
    } catch (error) {
      Alert.alert("신청을 등록하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header title="신청 작성" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {isProfileSessionBlocked(profileState.status) ? (
            <ProfileSessionGate status={profileState.status} returnTo="/profile/requests/new" guestBody="로그인하면 신청방에 원하는 상품을 등록할 수 있어요." />
          ) : profileState.status === "error" ? (
            <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={profileState.reload} />
          ) : <>
          <Text style={styles.label}>카테고리</Text>
          <View style={styles.chipRow}>
            {categoryOptions.map((option) => (
              <SeedChip
                key={option.value}
                label={option.label}
                selected={category === option.value}
                onPress={() => setCategory(option.value)}
              />
            ))}
          </View>

          {categoryComingSoon ? (
            <CategoryAvailabilityState category={category} style={styles.comingSoon} />
          ) : (
            <>
          <Text style={styles.label}>작품</Text>
          <SeedTextInput
            value={ipQuery}
            onChangeText={changeIpQuery}
            placeholder="작품 이름을 입력해 주세요"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {ipQuery.trim() && !selectedIp ? (
            <View style={styles.suggestions}>
              {suggestions.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.nameKo} 등록 IP 선택`}
                  onPress={() => chooseIp(option)}
                  style={({ pressed }) => [styles.suggestionRow, pressed && styles.pressed]}
                >
                  <View style={styles.suggestionCopy}>
                    <Text style={styles.suggestionName}>{option.nameKo}</Text>
                    {option.nameEn !== option.nameKo ? <Text numberOfLines={1} style={styles.suggestionMeta}>{option.nameEn}</Text> : null}
                  </View>
                  <Text style={styles.registeredBadge}>등록 IP</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.label}>찾는 상품</Text>
          <SeedTextInput
            value={desiredItem}
            onChangeText={(value) => setDesiredItem(value.slice(0, 160))}
            placeholder="정확한 상품명이나 특징"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.counter}>{desiredItem.length}/160</Text>

          <Text style={styles.label}>상세 내용</Text>
          <SeedTextInput
            value={details}
            onChangeText={(value) => setDetails(value.slice(0, 2_000))}
            placeholder="원하는 구성이나 찾는 이유를 적어 주세요."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.counter}>{details.length}/2000</Text>

          <Text style={styles.label}>사진</Text>
          {image ? (
            <View style={styles.photoPreview}>
              <Image source={{ uri: image.uri }} resizeMode="cover" style={styles.photo} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="첨부 사진 삭제"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={() => {
                  setImage(null);
                  setUploadedMediaId(null);
                }}
                style={({ pressed }) => [styles.photoRemove, pressed && styles.pressed]}
              >
                <DecorativeIonicon name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="사진 첨부"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              onPress={() => void chooseImage()}
              style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}
            >
              <DecorativeIonicon name="image-outline" size={22} color={colors.greenInk} />
              <Text style={styles.photoPickerLabel}>사진 첨부</Text>
            </Pressable>
          )}

          <SeedActionButton
            label={submitting ? "등록 중" : "신청 등록"}
            loading={submitting}
            onPress={() => void submit()}
            style={styles.submit}
          />
            </>
          )}
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  return <DetailPageHeader title={title} titleMode="pixel" onBack={() => router.back()} />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  label: { color: colors.ink, fontSize: 13, fontWeight: "900", marginTop: seed.spacing.x3, marginBottom: seed.spacing.x2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: seed.spacing.x2 },
  comingSoon: { marginHorizontal: 0, marginTop: seed.spacing.x4 },
  input: { minHeight: seed.size.input, paddingHorizontal: seed.spacing.x3_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, color: colors.ink, fontSize: 14 },
  suggestions: { marginTop: seed.spacing.x1_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, overflow: "hidden" },
  suggestionRow: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3, paddingVertical: seed.spacing.x2, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  suggestionCopy: { flex: 1, minWidth: 0 },
  suggestionName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  suggestionMeta: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x0_5 },
  registeredBadge: { color: colors.greenInk, ...seed.typography.finePrint, fontWeight: "800", marginLeft: seed.spacing.x2 },
  textarea: { minHeight: 150, paddingTop: seed.spacing.x3_5, paddingBottom: seed.spacing.x3_5 },
  counter: { color: colors.muted, ...seed.typography.finePrint, textAlign: "right", marginTop: seed.spacing.x1 },
  photoPicker: { minHeight: 84, borderWidth: 1, borderStyle: "dashed", borderColor: seed.color.stroke.brand, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center", gap: seed.spacing.x1 },
  photoPickerLabel: { color: colors.greenInk, fontSize: 13, fontWeight: "800" },
  photoPreview: { position: "relative", borderRadius: seed.radius.r3, overflow: "hidden", backgroundColor: seed.color.layer.default },
  photo: { width: "100%", aspectRatio: 4 / 3 },
  photoRemove: { position: "absolute", top: seed.spacing.x2, right: seed.spacing.x2, width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.size.touchTarget / 2, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.layer.elevated },
  submit: { marginTop: seed.spacing.x5 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
