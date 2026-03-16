export const CARD_STATUS = {
  PENDING: "pending",
  GENERATING: "generating",
  READY: "ready",
  EXPORTED: "exported",
  FAILED: "failed",
} as const;

export type CardStatus = typeof CARD_STATUS[keyof typeof CARD_STATUS];

export const CARD_STATUSES: readonly CardStatus[] = Object.values(CARD_STATUS);
