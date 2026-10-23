import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { listChatUserOptions, listMatterChannels } from "@/lib/chat/queries";
import { Card, CardContent } from "@/components/ui/card";
import { JoinMatterChannelButton, NewChannelForm } from "@/components/shared/chat-forms";

/**
 * A matter's internal channels. Matter access is asserted here and again
 * on every channel read/write, so removing someone from the matter also
 * removes their access to these conversations.
 */
export default async function MatterChatPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);
  const [channels, users] = await Promise.all([listMatterChannels(user, matterId), listChatUserOptions()]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Matter channels</h2>
        {channels.length === 0 && <p className="text-sm text-muted-foreground">No channels for this matter yet.</p>}
        {channels.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                {c.isMember ? (
                  <Link href={`/chat/${c.id}`} className="font-medium hover:underline">
                    # {c.name}
                  </Link>
                ) : (
                  <span className="font-medium"># {c.name}</span>
                )}
                {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                <p className="text-xs text-muted-foreground">
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                </p>
              </div>
              {!c.isMember && <JoinMatterChannelButton conversationId={c.id} />}
            </CardContent>
          </Card>
        ))}
      </div>
      <NewChannelForm users={users} currentUserId={user.id} matterId={matterId} />
    </div>
  );
}
