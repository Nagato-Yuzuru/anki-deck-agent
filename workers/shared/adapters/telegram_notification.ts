import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ChatNotificationPort } from "../ports/chat_notification.ts";
import type { NotificationError } from "../domain/errors.ts";

export type TelegramNotificationConfig = {
  readonly botToken: string;
  readonly fetchFn?: typeof fetch;
};

export function createTelegramNotification(config: TelegramNotificationConfig): ChatNotificationPort {
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;

  function attemptEdit(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError> {
    return ResultAsync.fromPromise(
      fetchFn(`${baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
        }),
      }),
      (err): NotificationError => ({
        kind: "notification",
        message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    ).andThen((response) => {
      if (response.ok) {
        console.log({ event: "notification_sent", chatId, messageId });
        return okAsync(undefined);
      }

      return ResultAsync.fromPromise(
        response.text(),
        (err): NotificationError => ({
          kind: "notification",
          message: `HTTP ${response.status} (failed to read body: ${err instanceof Error ? err.message : String(err)})`,
        }),
      ).andThen((bodyText) => {
        const truncatedBody = bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText;
        return errAsync<void, NotificationError>({
          kind: "notification",
          message: `HTTP ${response.status}: ${truncatedBody}`,
        });
      });
    });
  }

  return {
    editMessage(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError> {
      return attemptEdit(chatId, messageId, text).orElse((firstErr) => {
        console.warn({ event: "notification_retry", chatId, messageId, error: firstErr.message });
        return attemptEdit(chatId, messageId, text).orElse((secondErr) => {
          console.error({ event: "notification_failed", chatId, messageId, error: secondErr.message });
          return okAsync(undefined);
        });
      });
    },

    sendFile(
      chatId: string,
      file: Uint8Array,
      filename: string,
      caption?: string,
    ): ResultAsync<void, NotificationError> {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("document", new Blob([file.slice().buffer as ArrayBuffer]), filename);
      if (caption) {
        formData.append("caption", caption);
      }

      return ResultAsync.fromPromise(
        fetchFn(`${baseUrl}/sendDocument`, {
          method: "POST",
          body: formData,
        }),
        (err): NotificationError => ({
          kind: "notification",
          message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ).andThen((response) => {
        if (response.ok) {
          console.log({ event: "file_sent", chatId, filename });
          return okAsync(undefined);
        }

        return ResultAsync.fromPromise(
          response.text(),
          (err): NotificationError => ({
            kind: "notification",
            message: `HTTP ${response.status} (failed to read body: ${
              err instanceof Error ? err.message : String(err)
            })`,
          }),
        ).andThen((bodyText) => {
          const truncatedBody = bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText;
          return errAsync<void, NotificationError>({
            kind: "notification",
            message: `HTTP ${response.status}: ${truncatedBody}`,
          });
        });
      });
    },
  };
}
