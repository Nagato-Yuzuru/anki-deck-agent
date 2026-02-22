export const CARD_STATUS = {
  PENDING: "pending",
  READY: "ready",
  SYNCED: "synced",
} as const;

export type CardStatus = typeof CARD_STATUS[keyof typeof CARD_STATUS];

export const CARD_STATUSES: readonly CardStatus[] = Object.values(CARD_STATUS);
