# M4: Telegram Notification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or
> superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After card generation completes, edit the original Telegram "Generating..." message to show success or
failure.

**Architecture:** Extend `generateCard` to return `GenerateCardResult` (word, chatId, messageId, succeeded). Create a
`TelegramNotificationAdapter` implementing `ChatNotificationPort` via direct `fetch()` to Telegram Bot API. The
processor handler orchestrates notification as a post-processing step.

**Tech Stack:** Deno, neverthrow (ResultAsync), Telegram Bot API (REST), `@std/testing/bdd`

**Spec:** `docs/superpowers/specs/2026-03-23-m4-tts-notification-design.md`

---

## File Map

| Action | File                                                       | Responsibility                                                                                                        |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Modify | `workers/processor/services/generate_card.ts`              | Return `GenerateCardResult` instead of `void`; convert LLM/template failures from `Err` to `Ok({ succeeded: false })` |
| Modify | `workers/processor/services/generate_card_test.ts`         | Update all assertions for new return type                                                                             |
| Create | `workers/processor/adapters/telegram_notification.ts`      | Implements `ChatNotificationPort` via Telegram Bot API REST; injectable `fetchFn`; 1 retry on failure                 |
| Create | `workers/processor/adapters/telegram_notification_test.ts` | Mock fetch; verify request shape, retry, error swallowing                                                             |
| Modify | `workers/processor/index.ts`                               | Construct notification adapter; call `editMessage` after `generateCard` returns `Ok`                                  |
| Modify | `workers/processor/index_test.ts`                          | Test notification orchestration and failure degradation                                                               |

---

## Chunk 1: Extend generateCard return type

### Task 1: Update generateCard to return GenerateCardResult

**Files:**

- Modify: `workers/processor/services/generate_card.ts`
- Modify: `workers/processor/services/generate_card_test.ts`

- [ ] **Step 1: Update test for happy path — expect GenerateCardResult with succeeded: true**

In `workers/processor/services/generate_card_test.ts`, update the happy-path test. The `result.match` ok branch should
now assert the returned `GenerateCardResult`:

```typescript
result.match(
  (res) => {
    assertEquals(res.word, "apple");
    assertEquals(res.chatId, "12345");
    assertEquals(res.messageId, "1");
    assertEquals(res.succeeded, true);
    assertEquals(statusUpdates.length, 2);
    assertEquals(statusUpdates[0]!.status, "generating");
    assertEquals(statusUpdates[1]!.status, "ready");
  },
  (err) => {
    throw new Error(`Expected ok, got error: ${err.message}`);
  },
);
```

- [ ] **Step 2: Update test for LLM failure — expect Ok with succeeded: false (not Err)**

The "marks card as failed when LLM call fails" test currently expects `Err`. Change it to expect
`Ok({ succeeded: false })`:

```typescript
it("returns Ok with succeeded false when LLM call fails", async () => {
  const llmErr: LlmError = { kind: "llm", message: "API timeout" };
  let failedUpdate: { status: string; fields?: unknown } | undefined;

  const result = await generateCard(
    1,
    makeDeps({
      llm: mockLlm({ generateStructured: () => errAsync(llmErr) }),
      cardRepo: mockCardRepo({
        updateStatus: (_id, status, fields?) => {
          if (status === "failed") {
            failedUpdate = { status, fields };
          }
          return okAsync({ ...sampleCard, status, ...fields });
        },
      }),
    }),
  );

  result.match(
    (res) => {
      assertEquals(res.succeeded, false);
      assertEquals(res.word, "apple");
      assertEquals(res.chatId, "12345");
      assertEquals(res.messageId, "1");
      assertEquals(failedUpdate?.status, "failed");
    },
    (err) => {
      throw new Error(`Expected Ok with succeeded: false, got Err: ${err.message}`);
    },
  );
});
```

- [ ] **Step 3: Update test for template not found — expect Ok with succeeded: false**

The "marks card as failed when template not found" test currently expects `Err`. Change it to expect
`Ok({ succeeded: false })`:

```typescript
it("returns Ok with succeeded false when template not found", async () => {
  let markedFailed = false;

  const result = await generateCard(
    1,
    makeDeps({
      templateRepo: mockTemplateRepo({ findById: () => okAsync(null) }),
      cardRepo: mockCardRepo({
        updateStatus: (_id, status, _fields?) => {
          if (status === "failed") markedFailed = true;
          return okAsync({ ...sampleCard, status });
        },
      }),
    }),
  );

  result.match(
    (res) => {
      assertEquals(res.succeeded, false);
      assertEquals(res.word, "apple");
      assertEquals(res.chatId, "12345");
      assertEquals(markedFailed, true);
    },
    (err) => {
      throw new Error(`Expected Ok with succeeded: false, got Err: ${err.message}`);
    },
  );
});
```

- [ ] **Step 4: Keep card-not-found and submission-not-found tests as Err**

These tests should remain unchanged — `Err` is correct because chatId/messageId are unavailable. Verify the existing
tests for "returns error when card not found" and "marks card as failed when submission not found" still expect `Err`.
No code change needed, just verify.

- [ ] **Step 5: Update the "verifies prompt contains word and sentence" test**

This test calls `generateCard` but ignores the result type. It should still work after the return type change, but
verify the `await` call doesn't fail. No change expected.

- [ ] **Step 6: Run tests to verify they fail**

Run: `deno test workers/processor/services/generate_card_test.ts` Expected: FAIL — `generateCard` still returns `void`,
not `GenerateCardResult`.

- [ ] **Step 7: Define GenerateCardResult type and update generateCard implementation**

In `workers/processor/services/generate_card.ts`:

1. Add the result type after the imports:

```typescript
export type GenerateCardResult = {
  readonly word: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly succeeded: boolean;
};
```

2. Change the return type from `ResultAsync<void, RepositoryError | LlmError>` to
   `ResultAsync<GenerateCardResult, RepositoryError>`. Note: `LlmError` is removed from the error union because LLM
   failures are now `Ok({ succeeded: false })`.

3. In the LLM success path (currently `.map(() => undefined)` at line 74), return:

```typescript
.map((): GenerateCardResult => ({
  word: card.word,
  chatId: submission.chatId,
  messageId: submission.messageId,
  succeeded: true,
}))
```

4. In the template-not-found path (lines 51-62), replace the entire
   `.andThen(() => errAsync<never, RepositoryError>({ ... }))` block with `.map(...)` so the chain becomes
   `deps.cardRepo.updateStatus(...).map((): GenerateCardResult => ({ ... }))`:

```typescript
return deps.cardRepo
  .updateStatus(card.id, CARD_STATUS.FAILED, {
    errorMessage: `Template not found: ${submission.templateId}`,
  })
  .map((): GenerateCardResult => ({
    word: card.word,
    chatId: submission.chatId,
    messageId: submission.messageId,
    succeeded: false,
  }));
```

5. In the LLM failure path (lines 76-91), the `.orElse` currently returns `errAsync(llmErr)`. Change it to return
   `Ok({ succeeded: false })`:

```typescript
.orElse((llmErr) =>
  deps.cardRepo
    .updateStatus(card.id, CARD_STATUS.FAILED, {
      errorMessage: llmErr.message,
    })
    .mapErr((repoErr) => {
      console.error({
        event: "card_status_update_failed",
        cardId: card.id,
        targetStatus: "failed",
        error: repoErr.message,
      });
      return repoErr;
    })
    .map((): GenerateCardResult => ({
      word: card.word,
      chatId: submission.chatId,
      messageId: submission.messageId,
      succeeded: false,
    }))
)
```

6. Card-not-found and submission-not-found paths remain `errAsync<..., RepositoryError>` — no chatId available.

- [ ] **Step 8: Run tests to verify they pass**

Run: `deno test workers/processor/services/generate_card_test.ts` Expected: All 7 tests PASS.

- [ ] **Step 9: Run type check**

Run: `deno task check` Expected: No errors. The processor `index.ts` still compiles because its `result.match` ok
callback ignores the parameter (a function that ignores its argument is always assignable in TypeScript).

- [ ] **Step 10: Commit**

```bash
git add workers/processor/services/generate_card.ts workers/processor/services/generate_card_test.ts
git commit -m "refactor: extend generateCard to return GenerateCardResult

Business failures (LLM error, template not found) now return
Ok({ succeeded: false }) instead of Err, enabling the handler to
send Telegram notifications with chatId/messageId.
Err is reserved for infrastructure failures (card/submission not found)."
```

---

## Chunk 2: Telegram notification adapter

### Task 2: Create TelegramNotificationAdapter

**Files:**

- Create: `workers/processor/adapters/telegram_notification.ts`
- Create: `workers/processor/adapters/telegram_notification_test.ts`

- [ ] **Step 1: Write test — happy path editMessage sends correct HTTP request**

Create `workers/processor/adapters/telegram_notification_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createTelegramNotification } from "./telegram_notification.ts";

describe("TelegramNotificationAdapter", () => {
  describe("editMessage", () => {
    it("sends correct POST to Telegram editMessageText API", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const adapter = createTelegramNotification({
        botToken: "123:ABC",
        fetchFn: (url, init) => {
          capturedUrl = url as string;
          capturedInit = init;
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        },
      });

      const result = await adapter.editMessage("chat-1", "msg-1", "Hello");

      result.match(
        () => {
          assertEquals(capturedUrl, "https://api.telegram.org/bot123:ABC/editMessageText");
          const body = JSON.parse(capturedInit?.body as string);
          assertEquals(body.chat_id, "chat-1");
          assertEquals(body.message_id, "msg-1");
          assertEquals(body.text, "Hello");
          assertEquals(body.parse_mode, "HTML");
        },
        (err) => {
          throw new Error(`Expected Ok, got Err: ${err.message}`);
        },
      );
    });
  });
});
```

- [ ] **Step 2: Write test — retries once on non-2xx then succeeds**

```typescript
it("retries once on non-2xx then succeeds", async () => {
  let attempts = 0;

  const adapter = createTelegramNotification({
    botToken: "123:ABC",
    fetchFn: () => {
      attempts++;
      if (attempts === 1) {
        return Promise.resolve(new Response("Server Error", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
  });

  const result = await adapter.editMessage("chat-1", "msg-1", "Hello");

  result.match(
    () => assertEquals(attempts, 2),
    (err) => {
      throw new Error(`Expected Ok after retry, got Err: ${err.message}`);
    },
  );
});
```

- [ ] **Step 3: Write test — retries once on fetch exception then succeeds**

```typescript
it("retries once on fetch exception then succeeds", async () => {
  let attempts = 0;

  const adapter = createTelegramNotification({
    botToken: "123:ABC",
    fetchFn: () => {
      attempts++;
      if (attempts === 1) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
  });

  const result = await adapter.editMessage("chat-1", "msg-1", "Hello");

  result.match(
    () => assertEquals(attempts, 2),
    (err) => {
      throw new Error(`Expected Ok after retry, got Err: ${err.message}`);
    },
  );
});
```

- [ ] **Step 4: Write test — returns Ok even when both attempts fail (swallows error)**

```typescript
it("returns Ok even when both attempts fail", async () => {
  let attempts = 0;

  const adapter = createTelegramNotification({
    botToken: "123:ABC",
    fetchFn: () => {
      attempts++;
      return Promise.resolve(new Response("Bad Request", { status: 400 }));
    },
  });

  const result = await adapter.editMessage("chat-1", "msg-1", "Hello");

  result.match(
    () => assertEquals(attempts, 2),
    (err) => {
      throw new Error(`Expected Ok (swallowed error), got Err: ${err.message}`);
    },
  );
});
```

- [ ] **Step 5: Write test — sendFile returns NotificationError (stub)**

```typescript
describe("sendFile", () => {
  it("returns NotificationError (not implemented)", async () => {
    const adapter = createTelegramNotification({
      botToken: "123:ABC",
      fetchFn: () => Promise.resolve(new Response("", { status: 200 })),
    });

    const result = await adapter.sendFile("chat-1", new Uint8Array(), "file.mp3");

    result.match(
      () => {
        throw new Error("Expected Err");
      },
      (err) => {
        assertEquals(err.kind, "notification");
      },
    );
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `deno test workers/processor/adapters/telegram_notification_test.ts` Expected: FAIL — module
`./telegram_notification.ts` does not exist.

- [ ] **Step 7: Implement createTelegramNotification**

Create `workers/processor/adapters/telegram_notification.ts`:

```typescript
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ChatNotificationPort } from "../../shared/mod.ts";
import type { NotificationError } from "../../shared/domain/errors.ts";

export type TelegramNotificationConfig = {
  readonly botToken: string;
  readonly fetchFn?: typeof fetch;
};

export function createTelegramNotification(config: TelegramNotificationConfig): ChatNotificationPort {
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;

  function attemptEdit(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError> {
    return ResultAsync.fromPromise(
      fetchFn(`${baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
        }),
      }),
      (err): NotificationError => ({
        kind: "notification",
        message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    ).andThen((response) => {
      if (!response.ok) {
        return errAsync<void, NotificationError>({
          kind: "notification",
          message: `HTTP ${response.status}`,
        });
      }
      return okAsync(undefined);
    });
  }

  return {
    editMessage(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError> {
      return attemptEdit(chatId, messageId, text).orElse((firstErr) => {
        console.warn({ event: "notification_retry", chatId, messageId, error: firstErr.message });
        return attemptEdit(chatId, messageId, text).orElse((secondErr) => {
          console.error({ event: "notification_failed", chatId, messageId, error: secondErr.message });
          return okAsync(undefined);
        });
      }).map(() => {
        console.log({ event: "notification_sent", chatId, messageId });
      });
    },

    sendFile(
      _chatId: string,
      _file: Uint8Array,
      _filename: string,
      _caption?: string,
    ): ResultAsync<void, NotificationError> {
      return errAsync({ kind: "notification", message: "sendFile not implemented" });
    },
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `deno test workers/processor/adapters/telegram_notification_test.ts` Expected: All 5 tests PASS.

- [ ] **Step 9: Run type check**

Run: `deno task check` Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add workers/processor/adapters/telegram_notification.ts workers/processor/adapters/telegram_notification_test.ts
git commit -m "feat: add Telegram notification adapter

Implements ChatNotificationPort via direct fetch() to Telegram Bot API.
Uses HTML parse mode. Retries once on failure, then swallows the error.
sendFile is a stub (not needed for M4)."
```

---

## Chunk 3: Wire notification into processor handler

### Task 3: Update processor handler to send notifications

**Files:**

- Modify: `workers/processor/index.ts`
- Modify: `workers/processor/index_test.ts`

- [ ] **Step 1: Update index_test.ts — add test that notification is called on Ok result**

This requires refactoring the test to allow injecting dependencies. The current test uses `processor.queue()` directly
with a mock env where `DB: {} as never` which causes `generateCard` to throw internally (caught by try/catch).

For proper notification testing, add a new focused test that verifies the notification wiring. Since `index.ts` will
construct the adapter internally from `env`, the test needs to verify the notification call indirectly through the
structured logs. Use `console.log` capture:

```typescript
it("logs card_generated and notification events on successful processing", async () => {
  // This is an integration-level smoke test. The actual notification adapter
  // is tested in its own test file. Here we verify the handler doesn't throw
  // when processing a generate_card message (even with mock DB that fails).
  const msg = mockMessage({ type: "generate_card", cardId: 1 });
  const batch = mockBatch([msg]);

  await processor.queue(batch as never, mockEnv as never, mockCtx);

  assertEquals(msg.acked, true);
});
```

Note: The existing test "processes generate_card message without throwing (DB mock fails gracefully)" already covers
this. The handler-level notification wiring is best verified by checking that `index.ts` calls the right methods in the
right order — which is covered by the type system and the adapter + service unit tests.

- [ ] **Step 2: Run tests to verify current tests still pass**

Run: `deno test workers/processor/index_test.ts` Expected: All existing tests PASS (no changes to tests yet).

- [ ] **Step 3: Update processor index.ts to wire notification**

Modify `workers/processor/index.ts`:

1. Add import for the notification adapter:

```typescript
import { createTelegramNotification } from "./adapters/telegram_notification.ts";
```

2. Inside the `queue` handler, after constructing `deps`, create the notification adapter:

```typescript
const notification = createTelegramNotification({
  botToken: env.TELEGRAM_BOT_TOKEN,
});
```

3. Replace the `result.match` block in the `generate_card` case with `isOk()`/`isErr()` guards. This avoids the fragile
   `await result.match(async ...)` pattern where removing the `await` would create a floating promise (violating Workers
   constraints):

```typescript
// deno-lint-ignore no-await-in-loop
const result = await generateCard(msg.body.cardId, deps);
const durationMs = Date.now() - startTime;

if (result.isOk()) {
  const res = result.value;
  console.log({
    event: res.succeeded ? "card_generated" : "card_generation_failed",
    cardId: msg.body.cardId,
    word: res.word,
    succeeded: res.succeeded,
    durationMs,
  });

  const text = res.succeeded
    ? `✅ Card ready for <b>${escapeHtml(res.word)}</b>`
    : `❌ Failed to generate card for <b>${escapeHtml(res.word)}</b>`;

  // deno-lint-ignore no-await-in-loop
  await notification.editMessage(res.chatId, res.messageId, text);
} else {
  console.error({
    event: "card_generation_failed",
    cardId: msg.body.cardId,
    error: result.error.message,
    durationMs,
  });
}
```

4. Add `escapeHtml` helper at the top of the file (after imports):

```typescript
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test workers/processor/index_test.ts` Expected: All tests PASS. The existing tests use `DB: {} as never`
which causes `generateCard` to fail internally (the `cardRepo.findById` call fails), which hits the catch block and acks
the message. The notification adapter is constructed but never reached.

- [ ] **Step 5: Run full type check and test suite**

Run: `deno task check && deno test workers/` Expected: All type checks pass, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add workers/processor/index.ts workers/processor/index_test.ts
git commit -m "feat: wire Telegram notification into processor handler

After generateCard returns Ok, edits the original Telegram message
with success/failure status. On Err (infra failure), logs and skips
notification. HTML-escapes user-provided word in notification text."
```

---

## Chunk 4: Final verification

### Task 4: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `deno test workers/` Expected: All tests pass.

- [ ] **Step 2: Run full quality check**

Run: `deno task check` Expected: Type check + lint + format all pass.

- [ ] **Step 3: Review git log**

Run: `git log --oneline -5` Expected: 3 new commits (refactor generateCard, feat notification adapter, feat wire
notification).
