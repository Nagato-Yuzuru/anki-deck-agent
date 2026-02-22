import type { CardStatus } from "./card_status.ts";

export type Card = {
  readonly id: number;
  readonly deckId: number;
  readonly word: string;
  readonly sentence: string;
  readonly status: CardStatus;
  readonly audioR2Key: string | null;
  readonly ankiNoteId: number | null;
  readonly createdAt: string;
};
