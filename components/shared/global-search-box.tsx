"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "@/lib/search/params";

/**
 * Header search box. Submits a GET to /search; every result there is
 * produced by server-side, permission-scoped queries. Nothing is fetched
 * here and the query is never logged.
 */
export function GlobalSearchBox() {
  const router = useRouter();
  const [q, setQ] = React.useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} role="search" className="relative hidden w-64 lg:block">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="Search matters, contacts, tasks…"
        aria-label="Search"
        className="pl-8"
      />
    </form>
  );
}
