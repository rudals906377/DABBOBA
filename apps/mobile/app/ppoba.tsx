import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyPpobaRedirect() {
  const params = useLocalSearchParams<{ category?: string | string[]; ipId?: string | string[] }>();
  const category = firstParam(params.category);
  const ipId = firstParam(params.ipId);
  const pathname = category === "kuji" ? "/(tabs)/kuji" : "/(tabs)/gacha";

  return <Redirect href={{ pathname, params: ipId ? { ipId } : {} }} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
