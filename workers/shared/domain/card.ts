import type { CardStatus } from "./card_status.ts";

export type Card = {
  readonly id: number;
  readonly submissionId: number;
  readonly word: string;
  readonly sentence: string;
  readonly status: CardStatus;
  readonly llmResponseJson: string | null;
  readonly audioR2Key: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NewCard = Omit<
  Card,
  "id" | "status" | "llmResponseJson" | "audioR2Key" | "errorMessage" | "createdAt" | "updatedAt"
>;

export type CardUpdateFields = Partial<Pick<Card, "llmResponseJson" | "audioR2Key" | "errorMessage">>;
