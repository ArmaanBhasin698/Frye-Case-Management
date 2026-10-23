import { requireCurrentUser } from "@/lib/auth/session";
import { listChatUserOptions, listSidebarConversations } from "@/lib/chat/queries";
import { ChatSidebar } from "@/components/shared/chat-sidebar";
import { NewChannelForm, NewDirectMessageForm } from "@/components/shared/chat-forms";

/** Team Chat home: conversation list plus "start something new". Works with or without Slack. */
export default async function ChatPage() {
  const user = await requireCurrentUser();
  const [conversations, users] = await Promise.all([listSidebarConversations(user), listChatUserOptions()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Team Chat</h1>
        <p className="text-sm text-muted-foreground">
          Internal staff messaging. Messages stay inside Frye — nothing is sent to Slack or any other service.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ChatSidebar conversations={conversations} />
        <div className="grid gap-6 xl:grid-cols-2">
          <NewDirectMessageForm users={users} currentUserId={user.id} />
          <NewChannelForm users={users} currentUserId={user.id} />
        </div>
      </div>
    </div>
  );
}
