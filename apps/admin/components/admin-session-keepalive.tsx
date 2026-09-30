"use client";

import { useEffect } from "react";

const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1_000;
const KEEPALIVE_LOCK_NAME = "dabboba-admin-session-keepalive";

export function AdminSessionKeepalive() {
  useEffect(() => {
    let pending = false;
    const renew = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      const send = () => fetch("/api/auth/keepalive", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "cache-control": "no-store" },
      });
      try {
        // Every keepalive rotates the session cookie. Serialize renewals across
        // tabs so a second tab never presents a token that was just rotated.
        if (navigator.locks) {
          await navigator.locks.request(KEEPALIVE_LOCK_NAME, send);
        } else {
          await send();
        }
      } catch {
        // A temporary network failure must not discard the existing session.
      } finally {
        pending = false;
      }
    };
    void renew();
    const interval = window.setInterval(() => void renew(), KEEPALIVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", renew);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", renew);
    };
  }, []);
  return null;
}
