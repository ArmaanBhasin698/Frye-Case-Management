import Link from "next/link";

import { segmentMessageText } from "@/lib/chat/rules";
import type { MessageView } from "@/lib/chat/queries";

/**
 * Renders a message as plain text with https links only — never HTML (no
 * dangerouslySetInnerHTML anywhere in chat). Matter/document references
 * were already re-authorized for this viewer server-side; a restricted one
 * renders as a neutral placeholder that reveals nothing about it.
 */
export function ChatMessageBody({ message }: { message: MessageView }) {
  if (message.deleted || message.body === null) {
    return <p className="text-sm italic text-muted-foreground">Message deleted</p>;
  }
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap break-words text-sm">
        {segmentMessageText(message.body).map((segment, i) =>
          segment.type === "link" ? (
            <a key={i} href={segment.value} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
              {segment.value}
            </a>
          ) : (
            <span key={i}>{segment.value}</span>
          ),
        )}
      </p>
      {message.matterRef && (
        <p className="text-xs text-muted-foreground">
          Matter:{" "}
          {message.matterRef === "restricted" ? (
            <span>restricted matter</span>
          ) : (
            <Link href={`/matters/${message.matterRef.id}`} className="text-primary hover:underline">
              {message.matterRef.caseNumber}
            </Link>
          )}
        </p>
      )}
      {message.documentRef && (
        <p className="text-xs text-muted-foreground">
          Document:{" "}
          {message.documentRef === "restricted" ? (
            <span>restricted document</span>
          ) : (
            <a
              href={`/matters/${message.documentRef.matterId}/documents/files/${message.documentRef.id}`}
              className="text-primary hover:underline"
            >
              {message.documentRef.title}
            </a>
          )}
        </p>
      )}
    </div>
  );
}
