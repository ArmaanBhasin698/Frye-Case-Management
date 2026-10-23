"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessageBody } from "@/components/shared/chat-message-body";
import { deleteMessage, editMessage, markConversationRead, sendMessage, type ChatFormState } from "@/lib/chat/actions";
import { MESSAGE_MAX_LENGTH } from "@/lib/chat/rules";
import type { MessageView } from "@/lib/chat/queries";

const POLL_INTERVAL_MS = 5_000;
const INITIAL_STATE: ChatFormState = { error: null };

function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Message history + composer. Refreshes by polling the access-checked
 * route app/api/chat/[conversationId]/messages every 5 s (no real-time
 * dependency); a 404 there means access was revoked, so the view stops
 * polling and says so. The latest page is merged by id, which also picks
 * up edits and deletions.
 */
export function ChatConversationView({
  conversationId,
  initialMessages,
  initialHasOlder,
  isAdmin,
  isChannel,
  references,
}: {
  conversationId: string;
  initialMessages: MessageView[];
  initialHasOlder: boolean;
  isAdmin: boolean;
  isChannel: boolean;
  /** Matter channels only: the matter id and its documents, for optional references. */
  references?: { matterId: string; documents: { id: string; title: string }[] };
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState(initialMessages);
  const [hasOlder, setHasOlder] = React.useState(initialHasOlder);
  const [revoked, setRevoked] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const lastSeenRef = React.useRef<string | null>(initialMessages.at(-1)?.id ?? null);

  const refresh = React.useCallback(async () => {
    const response = await fetch(`/api/chat/${conversationId}/messages`, { cache: "no-store" });
    if (response.status === 404) {
      setRevoked(true);
      return;
    }
    if (!response.ok) return;
    const data = (await response.json()) as { messages: MessageView[] };
    setMessages((current) => mergeMessages(current, data.messages));
    const newestId = data.messages.at(-1)?.id ?? null;
    if (newestId && newestId !== lastSeenRef.current) {
      lastSeenRef.current = newestId;
      void markConversationRead({ conversationId });
    }
  }, [conversationId]);

  React.useEffect(() => {
    void markConversationRead({ conversationId }).then(() => router.refresh());
  }, [conversationId, router]);

  React.useEffect(() => {
    if (revoked) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, revoked]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // A form action (not useActionState) so React still resets the form after
  // a send, and the new message is fetched at once instead of on the next poll.
  async function send(formData: FormData) {
    const result = await sendMessage(INITIAL_STATE, formData);
    setSendError(result.error);
    if (!result.error) await refresh();
  }

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    const response = await fetch(`/api/chat/${conversationId}/messages?before=${encodeURIComponent(oldest.createdAt)}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await response.json()) as { messages: MessageView[]; hasOlder: boolean };
    setMessages((current) => mergeMessages(current, data.messages));
    setHasOlder(data.hasOlder);
  }

  async function saveEdit() {
    if (!editing) return;
    const result = await editMessage({ messageId: editing.id, body: editing.body });
    if (!result.ok) setActionError(result.error);
    else {
      setEditing(null);
      setActionError(null);
      void refresh();
    }
  }

  async function remove(messageId: string) {
    if (!window.confirm("Delete this message?")) return;
    const result = await deleteMessage({ messageId });
    if (!result.ok) setActionError(result.error);
    else void refresh();
  }

  if (revoked) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        You no longer have access to this conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[60vh] min-h-[300px] space-y-3 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {hasOlder && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet — say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className="group">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{m.authorName}</span>
              <time className="text-xs text-muted-foreground" dateTime={m.createdAt}>
                {format(new Date(m.createdAt), "MMM d, h:mm a")}
              </time>
              {m.edited && !m.deleted && <span className="text-xs text-muted-foreground">(edited)</span>}
              {!m.deleted && (m.isOwn || (isAdmin && isChannel)) && (
                <span className="ml-auto hidden gap-1 group-hover:flex">
                  {m.isOwn && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ id: m.id, body: m.body ?? "" })}>
                      Edit
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void remove(m.id)}>
                    Delete
                  </Button>
                </span>
              )}
            </div>
            {editing?.id === m.id ? (
              <div className="mt-1 space-y-2">
                <Textarea
                  value={editing.body}
                  maxLength={MESSAGE_MAX_LENGTH}
                  onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void saveEdit()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <ChatMessageBody message={m} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form action={send} className="space-y-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <Textarea
          name="body"
          required
          rows={3}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder="Write a message… (plain text; https links are clickable)"
          aria-label="Message"
        />
        {references && (
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="matterRefId" value={references.matterId} />
              Reference this matter
            </label>
            {references.documents.length > 0 && (
              <Select name="documentRefId" defaultValue="" className="h-8 w-64 text-xs" aria-label="Reference a document">
                <option value="">No document reference</option>
                {references.documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
        {(sendError || actionError) && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {sendError ?? actionError}
          </p>
        )}
        <div className="flex justify-end">
          <SendButton />
        </div>
      </form>
    </div>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Send"}
    </Button>
  );
}
