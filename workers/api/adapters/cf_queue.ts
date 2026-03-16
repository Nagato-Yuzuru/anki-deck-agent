import { ResultAsync } from "neverthrow";
import type { QueueError } from "../../shared/domain/errors.ts";
import type { QueueMessage, QueuePort } from "../../shared/ports/queue.ts";

export class CfQueue implements QueuePort {
  constructor(private readonly queue: Queue) {}

  send(message: QueueMessage): ResultAsync<void, QueueError> {
    return ResultAsync.fromPromise(
      this.queue.send(message),
      (err): QueueError => ({ kind: "queue", message: String(err) }),
    );
  }
}
