import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import type { ProcessorEnv, QueueMessage } from "../shared/mod.ts";

export default {
  queue(
    batch: MessageBatch<QueueMessage>,
    _env: ProcessorEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const msg of batch.messages) {
      switch (msg.body.type) {
        case "generate_card":
          console.log({ event: "queue_message_received", type: msg.body.type, cardId: msg.body.cardId });
          // TODO: delegate to generateCard service (Task 7)
          break;
        default:
          console.error({ event: "unknown_message_type", body: msg.body });
      }
      msg.ack();
    }
    return Promise.resolve();
  },
};
