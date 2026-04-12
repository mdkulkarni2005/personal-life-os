export interface ReplyContextPayload {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
}

/** Wraps the user's new text with quoted context for the model and deterministic helpers. */
export function buildMessageWithReplyContext(
  message: string,
  replyContext?: ReplyContextPayload | null
): string {
  if (!replyContext?.content?.trim()) return message;
  const label =
    replyContext.role === "user"
      ? "User"
      : replyContext.role === "assistant"
        ? "Assistant"
        : "System";
  return [
    "[The user is replying to this earlier message:]",
    `(${label}, id=${replyContext.id})`,
    `"""${replyContext.content.trim()}"""`,
    "[Their new message:]",
    message.trim(),
  ].join("\n");
}
