import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import type { ProcessorEnv, QueueMessage } from "../shared/mod.ts";
import { D1CardRepository } from "../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../shared/adapters/d1_submission_repository.ts";
import { D1TemplateRepository } from "../shared/adapters/d1_template_repository.ts";
import { classifyError } from "../shared/domain/errors.ts";
import { createOpenAiLlm } from "./adapters/openai_llm.ts";
import { createTelegramNotification } from "../shared/adapters/telegram_notification.ts";
import { generateCard } from "./services/generate_card.ts";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: ProcessorEnv,
    ctx: ExecutionContext,
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

    const notification = createTelegramNotification({
      botToken: env.TELEGRAM_BOT_TOKEN,
    });

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
            const durationMs = Date.now() - startTime;

            if (result.isOk()) {
              const res = result.value;
              const logEntry: Record<string, unknown> = {
                event: res.succeeded ? "card_generated" : "card_generation_failed",
                cardId: msg.body.cardId,
                word: res.word,
                succeeded: res.succeeded,
                durationMs,
              };

              if (!res.succeeded && res.errorMessage) {
                logEntry.errorMessage = res.errorMessage;
              }

              console.log(logEntry);

              const text = res.succeeded
                ? `✅ Card ready for <b>${escapeHtml(res.word)}</b>`
                : `❌ Failed to generate card for <b>${escapeHtml(res.word)}</b>`;

              ctx.waitUntil(notification.editMessage(res.chatId, res.messageId, text));
              msg.ack();
            } else {
              const classification = classifyError(result.error);
              console.error({
                event: "card_generation_failed",
                cardId: msg.body.cardId,
                error: result.error.message,
                classification,
                durationMs,
              });
              if (classification === "transient") {
                msg.retry();
              } else {
                msg.ack();
              }
            }
            break;
          }
          default:
            console.error({ event: "unknown_message_type", body: msg.body });
            msg.ack();
        }
      } catch (err) {
        console.error({
          event: "queue_message_processing_error",
          type: msg.body.type,
          body: msg.body,
          error: err instanceof Error ? err.message : String(err),
        });
        msg.retry();
      }
    }
  },
};
