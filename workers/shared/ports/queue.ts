import { z } from "@zod/zod";

export const GenerateDeckMessage = z.object({
  type: z.literal("generate_deck"),
  deckId: z.number().int().min(1),
});

export type GenerateDeckMessage = z.infer<typeof GenerateDeckMessage>;

export const QueueMessage = z.discriminatedUnion("type", [
  GenerateDeckMessage,
]);

export type QueueMessage = z.infer<typeof QueueMessage>;
