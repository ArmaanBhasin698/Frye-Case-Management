"use client";

import * as React from "react";
import { Copy, Video } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Join / Copy for a stored meeting link. The URL was validated as https
 * server-side (lib/calendar/meeting-url.ts) before it could be saved; it
 * opens in a new tab with `noopener noreferrer` so the meeting page gets no
 * handle back to this app and no referrer leaks the case URL.
 */
export function MeetingLinkActions({ url, providerLabel, compact = false }: { url: string; providerLabel: string; compact?: boolean }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this meeting link:", url);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <Video className="mr-1.5 h-3.5 w-3.5" />
          {compact ? "Join" : `Join ${providerLabel}`}
        </a>
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        <Copy className="mr-1.5 h-3.5 w-3.5" />
        {copied ? "Copied" : "Copy link"}
      </Button>
    </span>
  );
}
