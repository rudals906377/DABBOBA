export const ROOT_TABS = [
  { id: "community", label: "커뮤니티" },
  { id: "shop", label: "샵" },
  { id: "home", label: "홈" },
  { id: "duckroom", label: "덕룸" },
  { id: "profile", label: "프로필" },
] as const;

export type RootTabId = (typeof ROOT_TABS)[number]["id"];
