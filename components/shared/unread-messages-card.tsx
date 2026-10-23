import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Dashboard card for unread team-chat messages. Takes the result of
 * lib/chat/queries.ts#getUnreadChatSummary, which only counts
 * conversations the user can currently read.
 */
export function UnreadMessagesCard({
  summary,
}: {
  summary: { totalUnread: number; conversations: { id: string; label: string; unread: number }[] };
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Unread messages</CardTitle>
        <Link href="/chat" className="text-sm text-primary hover:underline">
          Open Team Chat
        </Link>
      </CardHeader>
      <CardContent>
        {summary.totalUnread === 0 ? (
          <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="space-y-1.5">
            {summary.conversations.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/chat/${c.id}`} className="truncate font-medium hover:underline">
                  {c.label}
                </Link>
                <Badge>{c.unread}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
