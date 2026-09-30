/**
 * Each profile screen requests only the snapshot sections it renders. Sections
 * outside a scope are left `null` (personal lists), empty (public lists), or
 * absent from `sectionErrors`; a screen must therefore only inspect the
 * sections its own scope loads.
 */
export type ProfileSnapshotScope =
  /** Every section with complete inventory paging. Retained for API compatibility; screens pick a narrower scope. */
  | "full"
  /** Account identity plus every inventory page; the only screen scope that pages the whole inventory. */
  | "storage"
  /** 내정보 summary: points, wishlist/order counts and the first inventory page. */
  | "home"
  /** Product history: wishlist and the first inventory page. */
  | "history"
  | "wishlist"
  /** Orders with the catalog used to label order lines. */
  | "orders"
  | "points"
  | "shipping"
  /** Customer support: public notices and the account's inquiries. */
  | "support"
  /** Public request-room feed. */
  | "requests"
  /** Request composition: catalog IP names only. */
  | "request-compose"
  /** Public notices only. */
  | "notices"
  /** Account identity only (profile, basic info, actor). */
  | "account"
  | "address"
  /** Member information hub: identity, address and notification preferences. */
  | "member";

export type ProfileSnapshotPlan = {
  catalog: "none" | "ips" | "products-and-ips";
  wanted: boolean;
  notices: boolean;
  address: boolean;
  wishlist: boolean;
  inventory: "none" | "first-page" | "all";
  orders: boolean;
  points: boolean;
  shipping: boolean;
  inquiries: boolean;
  preferences: boolean;
};

const NONE: ProfileSnapshotPlan = {
  catalog: "none",
  wanted: false,
  notices: false,
  address: false,
  wishlist: false,
  inventory: "none",
  orders: false,
  points: false,
  shipping: false,
  inquiries: false,
  preferences: false,
};

const PLANS: Record<Exclude<ProfileSnapshotScope, "storage">, ProfileSnapshotPlan> = {
  full: {
    catalog: "products-and-ips",
    wanted: true,
    notices: true,
    address: true,
    wishlist: true,
    inventory: "all",
    orders: true,
    points: true,
    shipping: true,
    inquiries: true,
    preferences: true,
  },
  home: { ...NONE, wishlist: true, inventory: "first-page", orders: true, points: true },
  history: { ...NONE, wishlist: true, inventory: "first-page" },
  wishlist: { ...NONE, wishlist: true },
  orders: { ...NONE, catalog: "products-and-ips", orders: true },
  points: { ...NONE, points: true },
  shipping: { ...NONE, shipping: true },
  support: { ...NONE, notices: true, inquiries: true },
  requests: { ...NONE, wanted: true },
  "request-compose": { ...NONE, catalog: "ips" },
  notices: { ...NONE, notices: true },
  account: NONE,
  address: { ...NONE, address: true },
  member: { ...NONE, address: true, preferences: true },
};

export function profileSnapshotPlan(scope: Exclude<ProfileSnapshotScope, "storage">): ProfileSnapshotPlan {
  return PLANS[scope];
}

/** Whether a guest request for this scope needs any public network data. */
export function profileScopeNeedsPublicData(plan: ProfileSnapshotPlan): boolean {
  return plan.catalog !== "none" || plan.wanted || plan.notices;
}
