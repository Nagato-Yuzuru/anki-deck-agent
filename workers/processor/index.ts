import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import type { ProcessorEnv, QueueMessage } from "../shared/mod.ts";
import { D1CardRepository } from "../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../shared/adapters/d1_submission_repository.ts";
import { D1TemplateRepository } from "../shared/adapters/d1_template_repository.ts";
import { createOpenAiLlm } from "./adapters/openai_llm.ts";
import { generateCard } from "./services/generate_card.ts";

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: ProcessorEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const deps = {
      cardRepo: new D1CardRepository(env.DB),
      submissionRepo: new D1SubmissionRepository(env.DB),
      templateRepo: new D1TemplateRepository(env.DB),
      llm: createOpenAiLlm({
        gatewayUrl: env.AI_GATEWAY_URL,
        apiKey: env.OPENAI_API_KEY,
        model: env.LLM_MODEL,
      }),
    };

    // Sequential processing is intentional — avoid overwhelming D1/LLM with concurrent requests.
    for (const msg of batch.messages) {
      try {
        switch (msg.body.type) {
          case "generate_card": {
            const startTime = Date.now();
            console.log({
              event: "queue_message_received",
              type: msg.body.type,
              cardId: msg.body.cardId,
            });

            // deno-lint-ignore no-await-in-loop
            const result = await generateCard(msg.body.cardId, deps);
            result.match(
              () => {
                console.log({
                  event: "card_generated",
                  cardId: msg.body.cardId,
                  durationMs: Date.now() - startTime,
                });
              },
              (err) => {
                console.error({
                  event: "card_generation_failed",
                  cardId: msg.body.cardId,
                  error: err.message,
                  durationMs: Date.now() - startTime,
                });
              },
            );
            break;
          }
          default:
            console.error({ event: "unknown_message_type", body: msg.body });
        }
      } catch (err) {
        console.error({
          event: "queue_message_processing_error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        msg.ack();
      }
    }
  },
};
