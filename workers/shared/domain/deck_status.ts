export const DECK_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
} as const;

export type DeckStatus = typeof DECK_STATUS[keyof typeof DECK_STATUS];

export const DECK_STATUSES: readonly DeckStatus[] = Object.values(DECK_STATUS);
