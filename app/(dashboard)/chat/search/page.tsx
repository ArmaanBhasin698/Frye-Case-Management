import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { listSidebarConversations, searchMessages } from "@/lib/chat/queries";
import { ChatSidebar } from "@/components/shared/chat-sidebar";
import { ChatMessageBody } from "@/components/shared/chat-message-body";

/** Message search — restricted server-side to conversations the user can currently read. */
export default async function ChatSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";
  const [results, conversations] = await Promise.all([searchMessages(user, q), listSidebarConversations(user)]);

  return (
    <div className="space-y-6">
      <h1 className="page-title">Search messages</h1>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ChatSidebar conversations={conversations} />
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {q.length < 2 ? "Enter at least two characters." : `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”.`}
          </p>
          {results.map((r) => (
            <Link key={r.id} href={r.parentId ? `/chat/${r.conversationId}?thread=${r.parentId}` : `/chat/${r.conversationId}`} className="block rounded-lg border border-border bg-card p-3 hover:bg-muted/40">
              <p className="text-xs text-muted-foreground">
                {r.conversationLabel} · {r.authorName} · {format(new Date(r.createdAt), "MMM d, yyyy h:mm a")}
              </p>
              <ChatMessageBody message={r} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
