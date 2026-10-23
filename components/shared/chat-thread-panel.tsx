"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessageBody } from "@/components/shared/chat-message-body";
import { markConversationRead, sendMessage, type ChatFormState } from "@/lib/chat/actions";
import { MESSAGE_MAX_LENGTH } from "@/lib/chat/rules";
import type { MessageView } from "@/lib/chat/queries";

const POLL_INTERVAL_MS = 5_000;
const INITIAL_STATE: ChatFormState = { error: null };

type ThreadPayload = { parent: MessageView; replies: MessageView[]; hasMore: boolean };

function mergeReplies(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * One reply thread. Reads through the same access-checked polling route as
 * the conversation (`?parentId=`), so membership and matter access are
 * re-checked on every poll; a 404 closes the thread as "no longer
 * available". The first page is re-polled (picking up edits/deletions);
 * later pages load forward with the (createdAt, id) cursor.
 */
export function ChatThreadPanel({
  conversationId,
  parentId,
  onClose,
  onChanged,
}: {
  conversationId: string;
  parentId: string;
  onClose: () => void;
  /** Lets the timeline refresh its reply counts after a reply is sent. */
  onChanged: () => void;
}) {
  const [parent, setParent] = React.useState<MessageView | null>(null);
  const [replies, setReplies] = React.useState<MessageView[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);

  const base = `/api/chat/${conversationId}/messages?parentId=${encodeURIComponent(parentId)}`;

  const load = React.useCallback(
    async (url: string, mode: "replace-first-page" | "append") => {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as ThreadPayload;
      setParent(data.parent);
      setReplies((current) => mergeReplies(current, data.replies));
      if (mode === "append" || data.replies.length > 0) setHasMore(data.hasMore);
    },
    [],
  );

  // The panel is keyed by parent id, so each thread mounts fresh state.
  // The first fetch is scheduled (not called inline) so no state update
  // happens synchronously inside the effect.
  React.useEffect(() => {
    if (unavailable) return;
    const poll = () => void load(base, "replace-first-page");
    const first = window.setTimeout(() => {
      poll();
      void markConversationRead({ conversationId });
    }, 0);
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [base, conversationId, load, unavailable]);

  async function loadMore() {
    const last = replies.at(-1);
    if (!last) return;
    await load(`${base}&afterAt=${encodeURIComponent(last.createdAt)}&afterId=${encodeURIComponent(last.id)}`, "append");
  }

  async function send(formData: FormData) {
    const result = await sendMessage(INITIAL_STATE, formData);
    setSendError(result.error);
    if (!result.error) {
      const last = replies.at(-1);
      await load(
        last ? `${base}&afterAt=${encodeURIComponent(last.createdAt)}&afterId=${encodeURIComponent(last.id)}` : base,
        "append",
      );
      onChanged();
    }
  }

  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" aria-label="Thread">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Thread</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {unavailable ? (
        <p className="text-sm text-muted-foreground">This thread is no longer available to you.</p>
      ) : !parent ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{parent.authorName}</span>
              <time className="text-xs text-muted-foreground" dateTime={parent.createdAt}>
                {format(new Date(parent.createdAt), "MMM d, h:mm a")}
              </time>
            </div>
            <ChatMessageBody message={parent} />
          </div>

          <p className="text-xs text-muted-foreground">
            {parent.replyCount} {parent.replyCount === 1 ? "reply" : "replies"}
          </p>

          <div className="max-h-[45vh] space-y-3 overflow-y-auto">
            {replies.map((m) => (
              <div key={m.id}>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{m.authorName}</span>
                  <time className="text-xs text-muted-foreground" dateTime={m.createdAt}>
                    {format(new Date(m.createdAt), "MMM d, h:mm a")}
                  </time>
                  {m.edited && !m.deleted && <span className="text-xs text-muted-foreground">(edited)</span>}
                </div>
                <ChatMessageBody message={m} />
              </div>
            ))}
            {hasMore && (
              <div className="text-center">
                <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                  Load more replies
                </Button>
              </div>
            )}
          </div>

          <form action={send} className="space-y-2">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="parentId" value={parentId} />
            <Textarea name="body" required rows={2} maxLength={MESSAGE_MAX_LENGTH} placeholder="Reply in thread…" aria-label="Reply" />
            {sendError && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {sendError}
              </p>
            )}
            <div className="flex justify-end">
              <ReplyButton />
            </div>
          </form>
        </>
      )}
    </aside>
  );
}

function ReplyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Reply"}
    </Button>
  );
}
