export type PublicAppLink = "privacy" | "terms" | "support" | "accountDeletion";

const PUBLIC_LINK_VALUES: Record<PublicAppLink, string | undefined> = {
  privacy: process.env.EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL,
  terms: process.env.EXPO_PUBLIC_DABBOBA_TERMS_URL,
  support: process.env.EXPO_PUBLIC_DABBOBA_SUPPORT_URL,
  accountDeletion: process.env.EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL,
};

export function resolvePublicAppLink(kind: PublicAppLink): string | null {
  const rawValue = PUBLIC_LINK_VALUES[kind]?.trim();
  if (!rawValue) return null;
  try {
    const url = new URL(rawValue);
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
