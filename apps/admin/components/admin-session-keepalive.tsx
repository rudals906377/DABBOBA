"use client";

import { useEffect } from "react";

const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1_000;

export function AdminSessionKeepalive() {
  useEffect(() => {
    let pending = false;
    const renew = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        await fetch("/api/auth/keepalive", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "cache-control": "no-store" },
        });
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
