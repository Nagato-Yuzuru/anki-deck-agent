import type { DeckStatus } from "./deck_status.ts";

export type Deck = {
  readonly id: number;
  readonly userId: number;
  readonly templateId: number;
  readonly status: DeckStatus;
  readonly telegramChatId: number;
  readonly telegramMessageId: number;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
