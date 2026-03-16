import type { ResultAsync } from "neverthrow";
import type { NotificationError } from "../domain/errors.ts";

export interface ChatNotificationPort {
  editMessage(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError>;
  sendFile(
    chatId: string,
    file: Uint8Array,
    filename: string,
    caption?: string,
  ): ResultAsync<void, NotificationError>;
}
