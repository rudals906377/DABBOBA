import type { ProfileSnapshot } from "@/features/profile/profile-api";

export type ProfileSessionStatus = "loading" | "guest" | "authenticated" | "expired" | "error";

export type ProfileSessionState = {
  status: ProfileSessionStatus;
  snapshot: ProfileSnapshot | null;
  accessToken: string | null;
  message: string;
  publicLoading: boolean;
};

export function loadingProfileSession(): ProfileSessionState {
  return { status: "loading", snapshot: null, accessToken: null, message: "", publicLoading: false };
}

export function guestProfileSession(
  snapshot: ProfileSnapshot,
  message = "",
  publicLoading = false,
): ProfileSessionState {
  return { status: "guest", snapshot, accessToken: null, message, publicLoading };
}

export function authenticatedProfileSession(
  snapshot: ProfileSnapshot,
  accessToken: string,
): ProfileSessionState {
  return { status: "authenticated", snapshot, accessToken, message: "", publicLoading: false };
}

export function expiredProfileSession(snapshot: ProfileSnapshot, publicLoading = false): ProfileSessionState {
  return { status: "expired", snapshot, accessToken: null, message: "", publicLoading };
}

export function failedProfileSession(message: string): ProfileSessionState {
  return { status: "error", snapshot: null, accessToken: null, message, publicLoading: false };
}
