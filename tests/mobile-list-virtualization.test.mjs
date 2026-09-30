import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../apps/mobile/src/${path}`, import.meta.url), "utf8");

const screens = {
  notifications: read("features/notifications/NotificationsScreen.tsx"),
  profileSection: read("features/profile/ProfileSectionScreen.tsx"),
  exchangeRoom: read("features/exchange/ExchangeRoomScreen.tsx"),
  search: read("features/search/ProductSearchScreen.tsx"),
};

test("record lists render through FlatList with stable keys, header, empty state and refresh", () => {
  for (const [name, source] of Object.entries(screens)) {
    assert.match(source, /<FlatList/, name);
    assert.match(source, /keyExtractor=/, name);
    assert.match(source, /ListEmptyComponent=/, name);
    assert.match(source, /ListHeaderComponent=/, name);
    assert.doesNotMatch(source, /\.map\(\(notification\) => \(\s*<NotificationRow/, name);
    assert.doesNotMatch(source, /import \{[^}]*\bText\b[^}]*\} from "react-native"/, name);
  }
  for (const name of ["notifications", "profileSection", "exchangeRoom"]) {
    assert.match(screens[name], /refreshControl=\{<RefreshControl|refreshControl=\{\s*<RefreshControl/, name);
  }
});

test("paginated notification and search lists load the next page at the end of the list", () => {
  assert.match(screens.notifications, /onEndReached=\{\(\) => \{\s*if \(showList && !autoLoadMoreBlocked\.current\) void loadMore\(\);/);
  assert.match(screens.notifications, /autoLoadMoreBlocked\.current = true;/);
  assert.match(screens.search, /onEndReached=\{\(\) => \{\s*if \(showResults && nextCursor && !loadingMore\) void load\(nextCursor\);/);
});

test("profile wishlist, shipping, order and point lists virtualize only their loaded success state", () => {
  const spec = screens.profileSection.slice(
    screens.profileSection.indexOf("function profileListSpec("),
    screens.profileSection.indexOf("export function StorageHubContent("),
  );
  for (const section of ["wishlist", "shipping", "orders", "points"]) {
    assert.match(spec, new RegExp(`if \\(section === "${section}"\\) \\{`), section);
  }
  assert.match(spec, /if \(!snapshot \|\| isProfileSessionBlocked\(profileState\.status\)\) return null;/);
  assert.match(spec, /if \(profileSectionFailure\(snapshot, "wishlist"\)\) return null;/);
  assert.match(spec, /pointBalance === null \|\| pointHistory === null\) return null;/);
});
