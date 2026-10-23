"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addChannelMember,
  createChannel,
  joinMatterChannel,
  removeChannelMember,
  startDirectConversation,
  type ChatFormState,
} from "@/lib/chat/actions";
import { GROUP_DM_MAX_PARTICIPANTS } from "@/lib/chat/rules";

const INITIAL_STATE: ChatFormState = { error: null };
type UserOption = { id: string; name: string };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-sm font-medium text-destructive" role="alert">
      {error}
    </p>
  ) : null;
}

/**
 * New channel. With `matterId`, the channel is a MATTER channel for that
 * matter (the server re-checks matter access for the creator and every
 * chosen member).
 */
export function NewChannelForm({ users, currentUserId, matterId }: { users: UserOption[]; currentUserId: string; matterId?: string }) {
  const [state, formAction, isPending] = useActionState(createChannel, INITIAL_STATE);
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">New channel</h2>
      {matterId ? (
        <>
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="channelKind" value="MATTER" />
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="channel-kind">Kind</Label>
          <Select id="channel-kind" name="channelKind" defaultValue="GENERAL">
            <option value="GENERAL">General discussion</option>
            <option value="TEAM">Team</option>
            <option value="DEPARTMENT">Department</option>
            <option value="TOPIC">Topic</option>
          </Select>
          <p className="text-xs text-muted-foreground">Matter channels are created from a matter&apos;s Chat tab.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="channel-name">Name</Label>
        <Input id="channel-name" name="name" required maxLength={80} placeholder="e.g. Trial Preparation" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-description">Description (optional)</Label>
        <Textarea id="channel-description" name="description" rows={2} maxLength={500} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Members</legend>
        <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
          {users
            .filter((u) => u.id !== currentUserId)
            .map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="memberIds" value={u.id} />
                {u.name}
              </label>
            ))}
        </div>
      </fieldset>
      <ErrorLine error={state.error} />
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Creating…" : "Create channel"}
      </Button>
    </form>
  );
}

/**
 * Start a direct message (one person) or a group message (2–4 others, 5
 * total). Membership is fixed once created; the same set of people always
 * reopens the same conversation.
 */
export function NewDirectMessageForm({ users, currentUserId }: { users: UserOption[]; currentUserId: string }) {
  const [state, formAction, isPending] = useActionState(startDirectConversation, INITIAL_STATE);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const maxOthers = GROUP_DM_MAX_PARTICIPANTS - 1;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxOthers) next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">New direct or group message</h2>
      <p className="text-xs text-muted-foreground">
        Pick one person for a direct message, or up to {maxOthers} for a group message ({GROUP_DM_MAX_PARTICIPANTS} people
        including you). Group membership can&apos;t be changed later — start a new group for a different set of people.
      </p>
      <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
        {users
          .filter((u) => u.id !== currentUserId)
          .map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="participantIds"
                value={u.id}
                checked={selected.has(u.id)}
                disabled={!selected.has(u.id) && selected.size >= maxOthers}
                onChange={() => toggle(u.id)}
              />
              {u.name}
            </label>
          ))}
      </div>
      <ErrorLine error={state.error} />
      <Button type="submit" size="sm" disabled={isPending || selected.size === 0}>
        {selected.size > 1 ? "Start group message" : "Start direct message"}
      </Button>
    </form>
  );
}

/** Channel member list. Add/remove controls render only for owners/ADMIN, and the server re-checks regardless. */
export function ChannelMembersPanel({
  conversationId,
  members,
  candidates,
  canManage,
  currentUserId,
}: {
  conversationId: string;
  members: { userId: string; name: string; isOwner: boolean }[];
  candidates: UserOption[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(addChannelMember, INITIAL_STATE);
  const [error, setError] = React.useState<string | null>(null);
  const memberIds = new Set(members.map((m) => m.userId));

  async function remove(userId: string) {
    const leaving = userId === currentUserId;
    if (!window.confirm(leaving ? "Leave this channel?" : "Remove this member?")) return;
    const result = await removeChannelMember({ conversationId, userId });
    if (!result.ok) setError(result.error);
    else if (leaving) router.push("/chat");
    else router.refresh();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Members ({members.length})</h2>
      <ul className="space-y-1 text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span>
              {m.name}
              {m.isOwner && <span className="text-xs text-muted-foreground"> · owner</span>}
            </span>
            {(canManage || m.userId === currentUserId) && (
              <Button variant="ghost" size="sm" onClick={() => void remove(m.userId)}>
                {m.userId === currentUserId ? "Leave" : "Remove"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form action={formAction} className="flex gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Select name="userId" required defaultValue="" aria-label="Add member" className="h-8 text-xs">
            <option value="" disabled>
              Add a member…
            </option>
            {candidates
              .filter((c) => !memberIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Button type="submit" size="sm" disabled={isPending}>
            Add
          </Button>
        </form>
      )}
      <ErrorLine error={state.error ?? error} />
    </div>
  );
}

export function JoinMatterChannelButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function join() {
    setPending(true);
    const result = await joinMatterChannel({ conversationId });
    setPending(false);
    if (!result.ok) setError(result.error);
    else router.push(`/chat/${conversationId}`);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void join()}>
        Join
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
