import type { ResultAsync } from "neverthrow";
import { z } from "@zod/zod";
import type { QueueError } from "../domain/errors.ts";

export const GenerateCardMessage = z.object({
  type: z.literal("generate_card"),
  cardId: z.number().int().min(1),
});

export type GenerateCardMessage = z.infer<typeof GenerateCardMessage>;

export const QueueMessage = z.discriminatedUnion("type", [
  GenerateCardMessage,
]);

export type QueueMessage = z.infer<typeof QueueMessage>;

export interface QueuePort {
  send(message: QueueMessage): ResultAsync<void, QueueError>;
}
