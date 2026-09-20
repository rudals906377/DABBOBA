import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuestSnapshot } from "../apps/mobile/src/features/profile/guest-profile-snapshot.ts";
import {
  authenticatedProfileSession,
  expiredProfileSession,
  failedProfileSession,
  guestProfileSession,
  loadingProfileSession,
} from "../apps/mobile/src/features/profile/profile-session-state.ts";
import {
  allowMissingProfileResponse,
  requireProfileResponse,
} from "../apps/mobile/src/features/profile/profile-response.ts";

const publicRequest = {
  id: "public-request",
  desiredItem: "공개 요청",
  mediaUrl: null,
};
const publicNotice = {
  id: "public-notice",
  title: "공개 공지",
};

test("guest snapshot keeps public records without synthesizing personal account data", () => {
  const snapshot = createGuestSnapshot(
    [],
    {},
    [publicRequest],
    [publicNotice],
  );

  assert.equal(snapshot.isExample, true);
  assert.equal(snapshot.actor, null);
  assert.equal(snapshot.profile.nickname, "");
  assert.equal(snapshot.profile.bio, null);
  assert.equal(snapshot.basicInfo.email, null);
  assert.equal(snapshot.defaultAddress, null);
  assert.deepEqual(snapshot.wishlist, []);
  assert.deepEqual(snapshot.inventory, []);
  assert.deepEqual(snapshot.orders, []);
  assert.deepEqual(snapshot.inquiries, []);
  assert.equal(snapshot.wantedRequests[0], publicRequest);
  assert.equal(snapshot.notices[0], publicNotice);
  assert.doesNotMatch(JSON.stringify(snapshot), /모찌|mobile-test@|홍\*동|합배송 가능/);
});

test("profile session states separate loading, guest, expired, and errors", () => {
  const guestSnapshot = createGuestSnapshot([], {}, [], []);

  assert.deepEqual(loadingProfileSession(), {
    status: "loading",
    snapshot: null,
    accessToken: null,
    message: "",
    publicLoading: false,
  });
  assert.equal(guestProfileSession(guestSnapshot).status, "guest");
  assert.equal(expiredProfileSession(guestSnapshot).status, "expired");
  assert.deepEqual(failedProfileSession("network failed"), {
    status: "error",
    snapshot: null,
    accessToken: null,
    message: "network failed",
    publicLoading: false,
  });
});

test("authenticated empty and populated snapshots remain server-authored", () => {
  const empty = { ...createGuestSnapshot([], {}, [], []), isExample: false };
  const populated = {
    ...empty,
    pointBalance: 3200,
    inventory: [{ id: "owned-unit" }],
    wishlist: [{ id: "wish-item" }],
  };

  const emptyState = authenticatedProfileSession(empty, "token-empty");
  const populatedState = authenticatedProfileSession(populated, "token-data");

  assert.equal(emptyState.status, "authenticated");
  assert.equal(emptyState.snapshot, empty);
  assert.deepEqual(emptyState.snapshot.inventory, []);
  assert.equal(populatedState.snapshot, populated);
  assert.equal(populatedState.snapshot.pointBalance, 3200);
  assert.equal(populatedState.snapshot.inventory[0].id, "owned-unit");
});

test("expired and error transitions cannot retain a stale private snapshot", () => {
  const stalePrivateSnapshot = {
    ...createGuestSnapshot([], {}, [], []),
    isExample: false,
    profile: {
      ...createGuestSnapshot([], {}, [], []).profile,
      nickname: "stale personal data",
    },
  };
  const guestSnapshot = createGuestSnapshot([], {}, [], []);

  const expired = expiredProfileSession(guestSnapshot);
  const failed = failedProfileSession("retry");

  assert.notEqual(expired.snapshot, stalePrivateSnapshot);
  assert.equal(expired.snapshot.profile.nickname, "");
  assert.equal(failed.snapshot, null);
});

test("authenticated response boundaries preserve data, allow only address 404, and reject partial failures", () => {
  const serverData = { items: [{ id: "server-owned" }] };
  assert.equal(
    requireProfileResponse(
      { data: serverData, response: { status: 200 } },
      (status) => new Error(`HTTP ${status}`),
    ),
    serverData,
  );
  assert.equal(
    allowMissingProfileResponse(
      { response: { status: 404 } },
      404,
      (status) => new Error(`HTTP ${status}`),
    ),
    null,
  );
  assert.throws(
    () => requireProfileResponse(
      { response: { status: 503 } },
      (status) => new Error(`HTTP ${status}`),
    ),
    /HTTP 503/,
  );
  assert.throws(
    () => allowMissingProfileResponse(
      { response: { status: 401 } },
      404,
      (status) => new Error(`HTTP ${status}`),
    ),
    /HTTP 401/,
  );
});
