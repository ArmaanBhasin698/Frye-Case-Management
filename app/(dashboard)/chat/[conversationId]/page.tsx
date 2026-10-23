import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { canManageChannel, getReadableConversation } from "@/lib/chat/access";
import {
  getConversationMembers,
  getConversationMessages,
  listChatUserOptions,
  listMatterDocumentOptions,
  listSidebarConversations,
} from "@/lib/chat/queries";
import { ChatSidebar } from "@/components/shared/chat-sidebar";
import { ChatConversationView } from "@/components/shared/chat-conversation-view";
import { ChannelMembersPanel } from "@/components/shared/chat-forms";
import { Badge } from "@/components/ui/badge";

/**
 * One conversation. `getReadableConversation` (membership + current matter
 * access) gates the whole page; anything else is the standard not-found.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { conversationId } = await params;
  const threadParam = (await searchParams).thread;
  // Only an id is passed through; the thread route re-checks access and
  // that the parent belongs to this conversation.
  const initialThreadId = typeof threadParam === "string" ? threadParam.slice(0, 100) : undefined;
  const user = await requireCurrentUser();
  const conversation = await getReadableConversation(user, conversationId);
  if (!conversation) notFound();

  const [history, conversations, members] = await Promise.all([
    getConversationMessages(user, conversationId),
    listSidebarConversations(user),
    getConversationMembers(conversationId),
  ]);
  if (!history) notFound();

  const isChannel = conversation.type === "CHANNEL";
  const [canManage, users, documents] = await Promise.all([
    isChannel ? canManageChannel(user, conversationId) : Promise.resolve(false),
    isChannel ? listChatUserOptions() : Promise.resolve([]),
    conversation.matterId ? listMatterDocumentOptions(conversation.matterId) : Promise.resolve([]),
  ]);

  const others = members.filter((m) => m.user.id !== user.id).map((m) => m.user.name);
  const title = isChannel ? `# ${conversation.name}` : others.join(", ") || "Just you";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/chat" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Team Chat
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="page-title">{title}</h1>
          {conversation.type === "GROUP" && <Badge variant="outline">Group message · fixed membership</Badge>}
          {conversation.type === "DIRECT" && <Badge variant="outline">Direct message</Badge>}
          {conversation.matterId && (
            <Link href={`/matters/${conversation.matterId}/chat`}>
              <Badge variant="secondary">Matter channel</Badge>
            </Link>
          )}
        </div>
        {conversation.description && <p className="mt-1 text-sm text-muted-foreground">{conversation.description}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ChatSidebar conversations={conversations} activeId={conversationId} />
        <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
          <ChatConversationView
            conversationId={conversationId}
            initialMessages={history.messages}
            initialHasOlder={history.hasOlder}
            isAdmin={isAdmin(user)}
            isChannel={isChannel}
            references={conversation.matterId ? { matterId: conversation.matterId, documents } : undefined}
            initialThreadId={initialThreadId}
          />
          {isChannel ? (
            <ChannelMembersPanel
              conversationId={conversationId}
              members={members.map((m) => ({ userId: m.user.id, name: m.user.name, isOwner: m.isOwner }))}
              candidates={users}
              canManage={canManage}
              currentUserId={user.id}
            />
          ) : (
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <h2 className="mb-2 font-semibold">Participants</h2>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.id}>{m.user.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
