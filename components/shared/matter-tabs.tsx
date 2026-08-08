"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { segment: "", label: "Overview" },
  { segment: "discovery", label: "Discovery" },
  { segment: "documents", label: "Documents" },
  { segment: "calls", label: "Calls" },
  { segment: "notes", label: "Notes" },
  { segment: "tasks", label: "Tasks" },
  { segment: "deadlines", label: "Deadlines" },
  { segment: "timeline", label: "Timeline" },
] as const;

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const basePath = `/matters/${matterId}`;
  const activeRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <div className="overflow-x-auto border-b border-border">
      <nav className="flex min-w-max gap-1" aria-label="Matter sections">
        {TABS.map((tab) => {
          const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
          const active = pathname === href;

          return (
            <Link
              key={tab.segment}
              href={href}
              ref={active ? activeRef : undefined}
              className={cn(
                "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
