import Link from "next/link";
import { Hash, MessageCircle, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { SidebarConversation } from "@/lib/chat/queries";

const SECTIONS = [
  { type: "CHANNEL", label: "Channels", icon: Hash },
  { type: "DIRECT", label: "Direct messages", icon: MessageCircle },
  { type: "GROUP", label: "Group messages", icon: Users },
] as const;

/**
 * Conversation list for Team Chat. `conversations` comes from
 * lib/chat/queries.ts#listSidebarConversations, which already excludes
 * anything the user can't read (including matter channels whose matter
 * access was revoked).
 */
export function ChatSidebar({ conversations, activeId }: { conversations: SidebarConversation[]; activeId?: string }) {
  return (
    <aside className="space-y-4 rounded-lg border border-border bg-card p-3">
      <form action="/chat/search" method="get">
        <Input name="q" placeholder="Search messages…" aria-label="Search messages" />
      </form>
      <Link href="/chat" className="block text-sm font-medium text-primary hover:underline">
        + New channel or message
      </Link>
      {SECTIONS.map((section) => {
        const items = conversations.filter((c) => c.type === section.type);
        return (
          <div key={section.type} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</p>
            {items.length === 0 && <p className="px-2 text-xs text-muted-foreground">None yet</p>}
            {items.map((c) => (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                  c.id === activeId && "bg-muted font-medium",
                  c.unread > 0 && "font-semibold",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <section.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.type === "CHANNEL" ? c.label.replace(/^# /, "") : c.label}</span>
                </span>
                {c.unread > 0 && <Badge className="shrink-0">{c.unread}</Badge>}
              </Link>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
