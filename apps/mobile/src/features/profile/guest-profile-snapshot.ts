import type { CatalogProduct, components } from "@dabboba/contracts";
import type { ProfileSnapshot, ProfileWantedRequest } from "./profile-api";

type Notice = components["schemas"]["Notice"];

const GUEST_PROFILE_ID = "00000000-0000-4000-8000-000000000000";

export function createGuestSnapshot(
  products: CatalogProduct[],
  ipNames: Record<string, string>,
  publicWanted: ProfileWantedRequest[],
  publicNotices: Notice[],
): ProfileSnapshot {
  const fetchedAt = new Date().toISOString();
  return {
    isExample: true,
    catalogProducts: products,
    ipNames,
    actor: null,
    profile: {
      id: GUEST_PROFILE_ID,
      nickname: "",
      bio: null,
      favoriteIp: null,
      version: 0,
      updatedAt: fetchedAt,
    },
    basicInfo: {
      id: GUEST_PROFILE_ID,
      nickname: "",
      email: null,
      phoneMasked: null,
      birthDate: null,
      version: 0,
      updatedAt: fetchedAt,
    },
    defaultAddress: null,
    wishlist: [],
    inventory: [],
    orders: [],
    pointBalance: 0,
    pointHistory: [],
    shippingRequests: [],
    wantedRequests: publicWanted,
    notices: publicNotices,
    inquiries: [],
    notificationPreferences: {
      orderUpdates: true,
      exchangeUpdates: false,
      requestUpdates: false,
      restockUpdates: false,
      marketingSms: false,
      marketingEmail: false,
      marketingPush: false,
      version: 0,
      updatedAt: fetchedAt,
    },
    sectionErrors: {},
    fetchedAt,
  };
}
