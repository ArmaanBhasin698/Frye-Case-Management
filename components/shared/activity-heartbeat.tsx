"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { HEARTBEAT_INTERVAL_SECONDS, IDLE_THRESHOLD_MINUTES } from "@/lib/usage/estimate";
import { matterIdFromPath, moduleForPath } from "@/lib/usage/sanitize";

/**
 * Sends an activity heartbeat (app/api/activity/heartbeat) once a minute,
 * but only while this tab is visible AND the user has interacted with it in
 * the last IDLE_THRESHOLD_MINUTES. Interaction is tracked as a single
 * timestamp — no keys, coordinates, or content are read or sent. The body
 * is just the current module and, on a matter page, the matter id.
 *
 * Mount once inside the signed-in app shell; takes no props.
 */
export function ActivityHeartbeat() {
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);
  const lastInteractionRef = React.useRef(0);

  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    lastInteractionRef.current = Date.now();
    const markActive = () => {
      lastInteractionRef.current = Date.now();
    };
    const events = ["keydown", "pointerdown", "scroll", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, markActive, { passive: true });

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInteractionRef.current > IDLE_THRESHOLD_MINUTES * 60_000) return;
      const path = pathRef.current;
      const matterId = matterIdFromPath(path);
      void fetch("/api/activity/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ module: moduleForPath(path), ...(matterId ? { matterId } : {}) }),
      }).catch(() => undefined);
    };

    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_SECONDS * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      for (const name of events) window.removeEventListener(name, markActive);
    };
  }, []);

  return null;
}
