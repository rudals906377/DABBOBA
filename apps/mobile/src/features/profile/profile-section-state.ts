import type { ProfileSnapshot, ProfileSnapshotSection } from "@/features/profile/profile-api";

/**
 * Personal snapshot sections whose request can fail independently of the
 * required account identity. A failed section is `null` on the snapshot and
 * carries its message in `sectionErrors`; it is never an empty successful list.
 */
export type ProfilePersonalSection = Extract<
  ProfileSnapshotSection,
  "wishlist" | "inventory" | "orders" | "points" | "shipping" | "inquiries" | "preferences" | "address"
>;

const SECTION_FAILURE_FALLBACK: Record<ProfilePersonalSection, string> = {
  wishlist: "찜 목록을 불러오지 못했어요.",
  inventory: "보관함을 불러오지 못했어요.",
  orders: "구매 내역을 불러오지 못했어요.",
  points: "포인트 정보를 불러오지 못했어요.",
  shipping: "배송 신청 내역을 불러오지 못했어요.",
  inquiries: "문의 내역을 불러오지 못했어요.",
  preferences: "알림 설정을 불러오지 못했어요.",
  address: "기본 배송지를 불러오지 못했어요.",
};

/**
 * Returns the customer-facing failure message for a personal section, or
 * `null` when that section loaded. Consumers render this retryable failure
 * before any empty state so a failed request never reads as "no records".
 */
export function profileSectionFailure(
  snapshot: ProfileSnapshot,
  section: ProfilePersonalSection,
): string | null {
  const recorded = snapshot.sectionErrors[section];
  if (recorded) return recorded;
  if (sectionMissing(snapshot, section)) return SECTION_FAILURE_FALLBACK[section];
  return null;
}

/**
 * Summarises several personal sections for a compact overview surface.
 * Returns the single failure message when exactly one section failed and a
 * short combined message when more than one failed.
 */
export function profileSectionsFailure(
  snapshot: ProfileSnapshot,
  sections: readonly ProfilePersonalSection[],
): string | null {
  const failures = sections
    .map((section) => profileSectionFailure(snapshot, section))
    .filter((message): message is string => Boolean(message));
  if (!failures.length) return null;
  return failures.length === 1 ? failures[0]! : "계정 정보 일부를 불러오지 못했어요.";
}

function sectionMissing(snapshot: ProfileSnapshot, section: ProfilePersonalSection): boolean {
  switch (section) {
    case "wishlist":
      return snapshot.wishlist === null;
    case "inventory":
      return snapshot.inventory === null;
    case "orders":
      return snapshot.orders === null;
    case "points":
      return snapshot.pointBalance === null || snapshot.pointHistory === null;
    case "shipping":
      return snapshot.shippingRequests === null;
    case "inquiries":
      return snapshot.inquiries === null;
    case "preferences":
      return snapshot.notificationPreferences === null;
    case "address":
      // A missing address is a valid state; only a recorded request failure counts.
      return false;
  }
}
