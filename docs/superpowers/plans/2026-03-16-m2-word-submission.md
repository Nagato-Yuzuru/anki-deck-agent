# M2: Word Submission Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or
> superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User sends `/add word | sentence` via Telegram → API worker validates, deduplicates against active cards,
persists to D1, enqueues a generation task → bot replies with confirmation.

**Architecture:** Hono HTTP worker with grammY webhook adapter as the Telegram input adapter. Pure `submitWord` service
orchestrates user upsert, duplicate check, submission+card creation, and queue dispatch via injected port interfaces. D1
repository adapters implement persistence ports using Drizzle ORM. All expected errors flow through `ResultAsync`.

**Tech Stack:** Deno, Hono, grammY (webhook mode), Cloudflare Workers (D1, Queues), Drizzle ORM, neverthrow, Zod

**Spec:** Design decisions documented in GitHub issue comments (#7, #9).

---

## File Map

| Action | File                                                  | Responsibility                                        |
| ------ | ----------------------------------------------------- | ----------------------------------------------------- |
| Modify | `deno.jsonc`                                          | Add `workers/api/` to workspace, add `grammy` dep     |
| Modify | `workers/api/deno.jsonc`                              | Workspace member config                               |
| Modify | `workers/shared/ports/card_repository.ts`             | Add `findActiveByUserIdAndWord` method                |
| Create | `workers/api/index.ts`                                | Hono app entry point, routes                          |
| Create | `workers/api/index_test.ts`                           | Health check test                                     |
| Create | `workers/api/test_helpers.ts`                         | Mock factories for ApiEnv, botInfo, port interfaces   |
| Create | `workers/api/handlers/add_command.ts`                 | `/add` parser — pure function                         |
| Create | `workers/api/handlers/add_command_test.ts`            | Parser test cases                                     |
| Create | `workers/api/adapters/telegram_webhook.ts`            | grammY bot factory + webhook callback                 |
| Create | `workers/api/adapters/telegram_webhook_test.ts`       | Webhook handler test                                  |
| Create | `workers/api/services/submit_word.ts`                 | `submitWord` business logic                           |
| Create | `workers/api/services/submit_word_test.ts`            | Service tests with mocked ports                       |
| Create | `workers/shared/adapters/d1_user_repository.ts`       | D1 `UserRepositoryPort` impl (shared between workers) |
| Create | `workers/shared/adapters/d1_submission_repository.ts` | D1 `SubmissionRepositoryPort` impl                    |
| Create | `workers/shared/adapters/d1_card_repository.ts`       | D1 `CardRepositoryPort` impl                          |
| Create | `workers/api/adapters/cf_queue.ts`                    | CF Queue `QueuePort` impl (api-only)                  |

---

## Chunk 1: Workspace Setup + Port Update + Hono Skeleton (Tasks 1–3, Issue #7)

### Task 1: Add `workers/api/` to Deno workspace

**Files:**

- Modify: `deno.jsonc`

The `workers/api/` directory has an empty `deno.jsonc` which shadows the root config. Without adding it to the workspace
array, imports like `@hono/hono` and `@std/assert` won't resolve for files in `workers/api/`.

- [ ] **Step 1: Add to workspace array**

In the root `deno.jsonc`, update the `"workspace"` array:

```jsonc
"workspace": [
  "./workers/shared/",
  "./workers/api/"
]
```

- [ ] **Step 2: Ensure `workers/api/deno.jsonc` is a valid workspace member**

If `workers/api/deno.jsonc` is empty, replace its content with a minimal workspace member config:

```jsonc
{
  "name": "@anki/api"
}
```

- [ ] **Step 3: Run type check**

Run: `deno task check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add deno.jsonc workers/api/deno.jsonc
git commit -m "chore: add workers/api to Deno workspace

Ensures API worker files inherit root import map and compiler options."
```

---

### Task 2: Add `findActiveByUserIdAndWord` to CardRepositoryPort

**Files:**

- Modify: `workers/shared/ports/card_repository.ts`

- [ ] **Step 1: Add the method to the interface**

Add after `findBySubmissionId` in `workers/shared/ports/card_repository.ts`:

```typescript
findActiveByUserIdAndWord(userId: number, word: string): ResultAsync<Card | null, RepositoryError>;
```

"Active" means status NOT IN (`exported`, `failed`). The implementation (Task 7) will join `cards` with `submissions` to
filter by `userId`.

- [ ] **Step 2: Run type check**

Run: `deno task check`

Expected: PASS — interface change is additive, no existing code implements it yet.

- [ ] **Step 3: Commit**

```bash
git add workers/shared/ports/card_repository.ts
git commit -m "feat(shared): add findActiveByUserIdAndWord to CardRepositoryPort

Active = status not in (exported, failed). Enables duplicate detection
for word submissions without wasting LLM tokens on in-progress cards.

Refs #9"
```

---

### Task 3: Hono app skeleton with `/-/health` (Issue #7)

**Files:**

- Create: `workers/api/index_test.ts`
- Create: `workers/api/index.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/api/index_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import app from "./index.ts";

describe("API Worker", () => {
  describe("GET /-/health", () => {
    it("should return 200 with status ok", async () => {
      const res = await app.request("/-/health");
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { status: "ok" });
    });
  });

  describe("unknown route", () => {
    it("should return 404", async () => {
      const res = await app.request("/nonexistent");
      assertEquals(res.status, 404);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test workers/api/index_test.ts`

Expected: FAIL — module `./index.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `workers/api/index.ts`:

```typescript
import { Hono } from "@hono/hono";
import type { ApiEnv } from "../shared/mod.ts";

const app = new Hono<{ Bindings: ApiEnv }>();

app.get("/-/health", (c) => c.json({ status: "ok" }));

export default app;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test workers/api/index_test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Run full check**

Run: `deno task check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/api/index.ts workers/api/index_test.ts
git commit -m "feat(api): Hono app skeleton with /-/health endpoint

Closes #7"
```

---

## Chunk 2: Command Parser + grammY Webhook (Tasks 4–5, Issues #10, #8)

### Task 4: `/add` command parser (Issue #10)

**Files:**

- Create: `workers/api/handlers/add_command_test.ts`
- Create: `workers/api/handlers/add_command.ts`

This is a pure function with no I/O — ideal for TDD.

- [ ] **Step 1: Write the failing tests**

Create `workers/api/handlers/add_command_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseAddCommand } from "./add_command.ts";

describe("parseAddCommand", () => {
  it("should parse word and sentence with pipe separator", () => {
    const result = parseAddCommand("apple | I ate an apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should parse word and sentence with newline separator", () => {
    const result = parseAddCommand("apple\nI ate an apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should trim whitespace from word and sentence", () => {
    const result = parseAddCommand("  apple  |  I ate an apple  ");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should reject empty input", () => {
    const result = parseAddCommand("");
    assertEquals(result.ok, false);
  });

  it("should reject whitespace-only input", () => {
    const result = parseAddCommand("   ");
    assertEquals(result.ok, false);
  });

  it("should reject input without separator", () => {
    const result = parseAddCommand("apple");
    assertEquals(result.ok, false);
  });

  it("should reject empty word", () => {
    const result = parseAddCommand(" | I ate an apple");
    assertEquals(result.ok, false);
  });

  it("should reject empty sentence", () => {
    const result = parseAddCommand("apple | ");
    assertEquals(result.ok, false);
  });

  it("should use first pipe as separator when multiple pipes exist", () => {
    const result = parseAddCommand("apple | I ate an apple | it was good");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple | it was good" });
  });

  it("should use first newline as separator when multiple newlines exist", () => {
    const result = parseAddCommand("apple\nI ate an apple\nit was good");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple\nit was good" });
  });

  it("should prefer pipe over newline when both present", () => {
    const result = parseAddCommand("apple | I ate\nan apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate\nan apple" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test workers/api/handlers/add_command_test.ts`

Expected: FAIL — module `./add_command.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `workers/api/handlers/add_command.ts`:

```typescript
type ParseSuccess = { readonly ok: true; readonly word: string; readonly sentence: string };
type ParseError = { readonly ok: false; readonly error: string };
export type ParseResult = ParseSuccess | ParseError;

export function parseAddCommand(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Input is empty. Usage: /add word | sentence" };
  }

  let word: string;
  let sentence: string;

  const pipeIndex = trimmed.indexOf("|");
  const newlineIndex = trimmed.indexOf("\n");

  if (pipeIndex !== -1) {
    word = trimmed.slice(0, pipeIndex).trim();
    sentence = trimmed.slice(pipeIndex + 1).trim();
  } else if (newlineIndex !== -1) {
    word = trimmed.slice(0, newlineIndex).trim();
    sentence = trimmed.slice(newlineIndex + 1).trim();
  } else {
    return { ok: false, error: "Missing separator. Usage: /add word | sentence" };
  }

  if (word === "") {
    return { ok: false, error: "Word is empty. Usage: /add word | sentence" };
  }
  if (sentence === "") {
    return { ok: false, error: "Sentence is empty. Usage: /add word | sentence" };
  }

  return { ok: true, word, sentence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test workers/api/handlers/add_command_test.ts`

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/api/handlers/add_command.ts workers/api/handlers/add_command_test.ts
git commit -m "feat(api): /add command parser with pipe and newline separators

Pure function, no I/O. Supports 'word | sentence' and 'word\\nsentence'.
Prefers pipe when both separators are present.

Closes #10"
```

---

### Task 5: grammY webhook integration (Issue #8)

**Files:**

- Modify: `deno.jsonc` — add grammy dependency
- Create: `workers/api/test_helpers.ts`
- Create: `workers/api/adapters/telegram_webhook_test.ts`
- Create: `workers/api/adapters/telegram_webhook.ts`
- Modify: `workers/api/index.ts` — register `POST /webhook`

- [ ] **Step 1: Add grammy dependency to deno.jsonc**

Add to the `"imports"` section in `deno.jsonc`:

```jsonc
"grammy": "npm:grammy@^1"
```

Run: `deno install` to update the lock file.

- [ ] **Step 2: Create test helpers**

Create `workers/api/test_helpers.ts`:

```typescript
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { ApiEnv } from "../shared/mod.ts";

export function mockApiEnv(overrides?: Partial<ApiEnv>): ApiEnv {
  return {
    DB: {} as D1Database,
    ASSETS: {} as R2Bucket,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    EVENTS: { send: () => Promise.resolve() } as unknown as Queue,
    ...overrides,
  };
}

export function makeTelegramUpdate(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    update_id: 123,
    message: {
      message_id: 1,
      from: { id: 12345, is_bot: false, first_name: "Test" },
      chat: { id: 12345, type: "private" },
      date: 1234567890,
      text: "/start",
    },
    ...overrides,
  };
}
```

- [ ] **Step 3: Write the failing webhook test**

Create `workers/api/adapters/telegram_webhook_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import app from "../index.ts";
import { makeTelegramUpdate, mockApiEnv } from "../test_helpers.ts";

describe("POST /webhook", () => {
  it("should return 200 for a valid Telegram update", async () => {
    const env = mockApiEnv();
    const update = makeTelegramUpdate();

    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }, env);

    assertEquals(res.status, 200);
  });

  it("should return 200 for an unknown update (grammY ignores it)", async () => {
    const env = mockApiEnv();

    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 999 }),
    }, env);

    assertEquals(res.status, 200);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `deno test workers/api/adapters/telegram_webhook_test.ts`

Expected: FAIL — `POST /webhook` returns 404 (route not registered yet).

- [ ] **Step 5: Create the webhook adapter**

Create `workers/api/adapters/telegram_webhook.ts`:

The adapter accepts an optional `botInfo` parameter. In production, the first request per isolate calls `bot.init()`
(one `getMe` API call) and caches the result. In tests, `botInfo` is injected to avoid network calls.

```typescript
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv } from "../../shared/mod.ts";

// Cache per isolate — immutable bot metadata, not mutable application state.
let cachedBotInfo: UserFromGetMe | undefined;

export type WebhookOptions = {
  readonly botInfo?: UserFromGetMe;
};

export async function handleWebhook(
  req: Request,
  env: ApiEnv,
  options?: WebhookOptions,
): Promise<Response> {
  const botInfo = options?.botInfo ?? cachedBotInfo;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { botInfo });

  if (botInfo === undefined) {
    await bot.init();
    cachedBotInfo = bot.botInfo;
  }

  // Command handlers will be registered here in Task 8 (wiring).

  const handler = webhookCallback(bot, "cloudflare-mod");
  return handler(req);
}
```

- [ ] **Step 6: Add mockBotInfo to test helpers**

Add to `workers/api/test_helpers.ts`:

```typescript
import type { UserFromGetMe } from "grammy/types";

export function mockBotInfo(): UserFromGetMe {
  return {
    id: 123,
    is_bot: true,
    first_name: "TestBot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
}
```

- [ ] **Step 7: Register the webhook route in index.ts**

Update `workers/api/index.ts`:

```typescript
import { Hono } from "@hono/hono";
import type { ApiEnv } from "../shared/mod.ts";
import { handleWebhook } from "./adapters/telegram_webhook.ts";

const app = new Hono<{ Bindings: ApiEnv }>();

app.get("/-/health", (c) => c.json({ status: "ok" }));

app.post("/webhook", (c) => handleWebhook(c.req.raw, c.env));

export default app;
```

- [ ] **Step 8: Update webhook test to inject botInfo**

Update the test in `workers/api/adapters/telegram_webhook_test.ts` to bypass `bot.init()`:

> **Note:** The test cannot use `app.request()` to inject `botInfo` because the Hono route handler doesn't expose the
> options parameter. Instead, test `handleWebhook` directly:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handleWebhook } from "./telegram_webhook.ts";
import { makeTelegramUpdate, mockApiEnv, mockBotInfo } from "../test_helpers.ts";

describe("handleWebhook", () => {
  it("should return 200 for a valid Telegram update", async () => {
    const env = mockApiEnv();
    const update = makeTelegramUpdate();
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    const res = await handleWebhook(req, env, { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });

  it("should return 200 for an unknown update (grammY ignores it)", async () => {
    const env = mockApiEnv();
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 999 }),
    });

    const res = await handleWebhook(req, env, { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });
});
```

- [ ] **Step 9: Run tests**

Run: `deno test workers/api/`

Expected: PASS — health check (2 tests) + webhook (2 tests) = 4 tests.

- [ ] **Step 10: Run full check**

Run: `deno task check`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add deno.jsonc deno.lock workers/api/index.ts workers/api/test_helpers.ts \
  workers/api/adapters/telegram_webhook.ts workers/api/adapters/telegram_webhook_test.ts
git commit -m "feat(api): grammY webhook integration with Hono

- Add grammy dependency
- POST /webhook route delegates to grammY webhookCallback
- Cache botInfo per isolate to avoid repeated getMe calls
- Add test helpers (mockApiEnv, makeTelegramUpdate)

Closes #8"
```

---

## Chunk 3: Service + Adapters + Wiring (Tasks 6–8, Issues #9, #11)

### Task 6: `submitWord` service (Issue #9)

**Files:**

- Create: `workers/api/services/submit_word_test.ts`
- Create: `workers/api/services/submit_word.ts`

Pure business logic. All ports are injected. Tests use mock implementations.

> **Eventual consistency note:** If queue dispatch fails after card creation, the card remains in `pending` status with
> no queue message. This is acceptable for M2 — the processor's error handling (M3, Issue #23) will add retry/cleanup
> logic. For now, the error is surfaced to the user via "Something went wrong."

- [ ] **Step 1: Write the failing tests**

Create `workers/api/services/submit_word_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type {
  Card,
  CardRepositoryPort,
  NewCard,
  QueuePort,
  SubmissionRepositoryPort,
  UserRepositoryPort,
} from "../../shared/mod.ts";
import type { QueueError, RepositoryError } from "../../shared/domain/errors.ts";
import type { QueueMessage } from "../../shared/ports/queue.ts";
import { submitWord } from "./submit_word.ts";

function mockUserRepo(overrides?: Partial<UserRepositoryPort>): UserRepositoryPort {
  return {
    upsert: () =>
      okAsync({ telegramId: 100, firstName: "Test", languageCode: null, createdAt: "2026-01-01T00:00:00Z" }),
    ...overrides,
  };
}

function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(null),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: (card: NewCard) =>
      okAsync({
        id: 1,
        ...card,
        status: "pending" as const,
        llmResponseJson: null,
        audioR2Key: null,
        errorMessage: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    updateStatus: () => okAsync({} as Card),
    ...overrides,
  };
}

function mockSubmissionRepo(overrides?: Partial<SubmissionRepositoryPort>): SubmissionRepositoryPort {
  return {
    findById: () => okAsync(null),
    create: (sub) =>
      okAsync({
        id: 1,
        ...sub,
        status: "pending" as const,
        errorMessage: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    updateStatus: () => okAsync({} as never),
    ...overrides,
  };
}

function mockQueuePort(overrides?: Partial<QueuePort>): QueuePort {
  return {
    send: () => okAsync(undefined),
    ...overrides,
  };
}

const baseInput = {
  userId: 100,
  firstName: "Test",
  languageCode: null as null,
  word: "apple",
  sentence: "I ate an apple",
  chatId: "12345",
  messageId: "1",
  templateId: 1,
};

describe("submitWord", () => {
  it("should create a new card and enqueue generation when no duplicate exists", async () => {
    let enqueuedMessage: QueueMessage | undefined;
    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort({
        send: (msg) => {
          enqueuedMessage = msg;
          return okAsync(undefined);
        },
      }),
    });

    result.match(
      (val) => {
        assertEquals(val.isNew, true);
        assertEquals(val.cardId, 1);
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
    assertEquals(enqueuedMessage?.type, "generate_card");
  });

  it("should return existing card info when duplicate is found", async () => {
    const existingCard: Card = {
      id: 42,
      submissionId: 10,
      word: "apple",
      sentence: "I ate an apple",
      status: "generating",
      llmResponseJson: null,
      audioR2Key: null,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo({ findActiveByUserIdAndWord: () => okAsync(existingCard) }),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort(),
    });

    result.match(
      (val) => {
        assertEquals(val.isNew, false);
        assertEquals(val.cardId, 42);
        assertEquals(val.existingStatus, "generating");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should propagate repository errors", async () => {
    const repoErr: RepositoryError = { kind: "repository", message: "DB down" };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo({ upsert: () => errAsync(repoErr) }),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort(),
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
      },
    );
  });

  it("should propagate queue errors", async () => {
    const queueErr: QueueError = { kind: "queue", message: "Queue full" };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort({ send: () => errAsync(queueErr) }),
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "queue");
      },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test workers/api/services/submit_word_test.ts`

Expected: FAIL — module `./submit_word.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `workers/api/services/submit_word.ts`:

```typescript
import { type ResultAsync } from "neverthrow";
import type {
  CardRepositoryPort,
  CardStatus,
  Language,
  QueuePort,
  SubmissionRepositoryPort,
  UserRepositoryPort,
} from "../../shared/mod.ts";
import type { QueueError, RepositoryError } from "../../shared/domain/errors.ts";

export type SubmitWordInput = {
  readonly userId: number;
  readonly firstName: string;
  readonly languageCode: Language | null;
  readonly word: string;
  readonly sentence: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly templateId: number;
};

export type SubmitWordResult = {
  readonly cardId: number;
  readonly isNew: boolean;
  readonly existingStatus?: CardStatus;
};

export type SubmitWordDeps = {
  readonly userRepo: UserRepositoryPort;
  readonly cardRepo: CardRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
  readonly queue: QueuePort;
};

export function submitWord(
  input: SubmitWordInput,
  deps: SubmitWordDeps,
): ResultAsync<SubmitWordResult, RepositoryError | QueueError> {
  return deps.userRepo
    .upsert({ telegramId: input.userId, firstName: input.firstName, languageCode: input.languageCode })
    .andThen(() => deps.cardRepo.findActiveByUserIdAndWord(input.userId, input.word))
    .andThen((existingCard) => {
      if (existingCard) {
        return deps.submissionRepo
          .create({
            userId: input.userId,
            templateId: input.templateId,
            chatId: input.chatId,
            messageId: input.messageId,
          })
          // Submission created for audit trail, but card already exists
          .map((): SubmitWordResult => ({
            cardId: existingCard.id,
            isNew: false,
            existingStatus: existingCard.status,
          }));
      }

      return deps.submissionRepo
        .create({
          userId: input.userId,
          templateId: input.templateId,
          chatId: input.chatId,
          messageId: input.messageId,
        })
        .andThen((submission) =>
          deps.cardRepo.create({
            submissionId: submission.id,
            word: input.word,
            sentence: input.sentence,
          })
        )
        .andThen((card) =>
          deps.queue
            .send({ type: "generate_card", cardId: card.id })
            .map((): SubmitWordResult => ({ cardId: card.id, isNew: true }))
        );
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test workers/api/services/submit_word_test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/api/services/submit_word.ts workers/api/services/submit_word_test.ts
git commit -m "feat(api): submitWord service with duplicate detection

Pure business logic: upsert user → check active cards → create
submission+card → enqueue generation. Returns existing card info
when duplicate found (active cards only, not exported/failed).

Closes #9"
```

---

### Task 7: D1 repository adapters + CF queue adapter

**Files:**

- Create: `workers/shared/adapters/d1_user_repository.ts`
- Create: `workers/shared/adapters/d1_submission_repository.ts`
- Create: `workers/shared/adapters/d1_card_repository.ts`
- Create: `workers/api/adapters/cf_queue.ts`

These are thin Drizzle wrappers. Each method wraps the Drizzle call in `ResultAsync.fromPromise` and maps errors to
domain error types. No unit tests for adapters — they are type-safe Drizzle queries tested indirectly via service-layer
tests (mocked) and future integration tests. The `findActiveByUserIdAndWord` JOIN is the most complex query and is a
candidate for integration testing in a later milestone.

**Note:** D1 adapters live in `workers/shared/adapters/` because both `api/` and `processor/` workers need them. They
are NOT re-exported from `shared/mod.ts` — each worker imports them directly from the adapter file. This keeps the
`mod.ts` barrel clean (only domain types, ports, and schemas) while allowing adapter reuse.

- [ ] **Step 1: Create D1UserRepository**

Create `workers/shared/adapters/d1_user_repository.ts`:

```typescript
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { NewUser, User } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { UserRepositoryPort } from "../ports/user_repository.ts";
import { users } from "../db/schema.ts";

export class D1UserRepository implements UserRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  upsert(user: NewUser): ResultAsync<User, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(users)
        .values({
          telegramId: user.telegramId,
          firstName: user.firstName,
          languageCode: user.languageCode,
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set: { firstName: user.firstName, languageCode: user.languageCode },
        })
        .returning()
        .then((rows) => {
          const row = rows[0]!;
          return {
            telegramId: row.telegramId,
            firstName: row.firstName,
            languageCode: row.languageCode,
            createdAt: row.createdAt,
          };
        }),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }
}
```

- [ ] **Step 2: Create D1SubmissionRepository**

Create `workers/shared/adapters/d1_submission_repository.ts`:

```typescript
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { NewSubmission, Submission, SubmissionStatus, SubmissionUpdateFields } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { SubmissionRepositoryPort } from "../ports/submission_repository.ts";
import { submissions } from "../db/schema.ts";

export class D1SubmissionRepository implements SubmissionRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<Submission | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, id))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  create(submission: NewSubmission): ResultAsync<Submission, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(submissions)
        .values({
          userId: submission.userId,
          templateId: submission.templateId,
          chatId: submission.chatId,
          messageId: submission.messageId,
        })
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateStatus(
    id: number,
    status: SubmissionStatus,
    fields?: SubmissionUpdateFields,
  ): ResultAsync<Submission, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(submissions)
        .set({ status, ...fields, updatedAt: new Date().toISOString() })
        .where(eq(submissions.id, id))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof submissions.$inferSelect): Submission {
    return {
      id: row.id,
      userId: row.userId,
      templateId: row.templateId,
      chatId: row.chatId,
      messageId: row.messageId,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 3: Create D1CardRepository**

Create `workers/shared/adapters/d1_card_repository.ts`:

```typescript
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { Card, CardStatus, CardUpdateFields, NewCard } from "../domain/mod.ts";
import { CARD_STATUS } from "../domain/card_status.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { CardRepositoryPort } from "../ports/card_repository.ts";
import { cards, submissions } from "../db/schema.ts";

const TERMINAL_STATUSES: CardStatus[] = [CARD_STATUS.EXPORTED, CARD_STATUS.FAILED];

export class D1CardRepository implements CardRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<Card | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cards)
        .where(eq(cards.id, id))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cards)
        .where(eq(cards.submissionId, submissionId))
        .then((rows) => rows.map((r) => this.toDomain(r))),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findActiveByUserIdAndWord(userId: number, word: string): ResultAsync<Card | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select({ card: cards })
        .from(cards)
        .innerJoin(submissions, eq(cards.submissionId, submissions.id))
        .where(
          and(
            eq(submissions.userId, userId),
            eq(cards.word, word),
            notInArray(cards.status, TERMINAL_STATUSES),
          ),
        )
        .limit(1)
        .then((rows) => (rows[0] ? this.toDomain(rows[0].card) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  create(card: NewCard): ResultAsync<Card, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(cards)
        .values({
          submissionId: card.submissionId,
          word: card.word,
          sentence: card.sentence,
        })
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateStatus(id: number, status: CardStatus, fields?: CardUpdateFields): ResultAsync<Card, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(cards)
        .set({ status, ...fields, updatedAt: new Date().toISOString() })
        .where(eq(cards.id, id))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof cards.$inferSelect): Card {
    return {
      id: row.id,
      submissionId: row.submissionId,
      word: row.word,
      sentence: row.sentence,
      status: row.status,
      llmResponseJson: row.llmResponseJson,
      audioR2Key: row.audioR2Key,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 4: Create CfQueue adapter**

Create `workers/api/adapters/cf_queue.ts`:

```typescript
import { ResultAsync } from "neverthrow";
import type { QueueError } from "../../shared/domain/errors.ts";
import type { QueuePort } from "../../shared/ports/queue.ts";
import type { QueueMessage } from "../../shared/ports/queue.ts";

export class CfQueue implements QueuePort {
  constructor(private readonly queue: Queue) {}

  send(message: QueueMessage): ResultAsync<void, QueueError> {
    return ResultAsync.fromPromise(
      this.queue.send(message),
      (err): QueueError => ({ kind: "queue", message: String(err) }),
    );
  }
}
```

- [ ] **Step 5: Run type check**

Run: `deno task check`

Expected: PASS — all adapters type-check against their port interfaces.

- [ ] **Step 6: Commit**

```bash
git add workers/shared/adapters/ workers/api/adapters/cf_queue.ts
git commit -m "feat: D1 repository adapters and CF queue adapter

- D1UserRepository: upsert via INSERT ON CONFLICT UPDATE
- D1SubmissionRepository: CRUD with Drizzle
- D1CardRepository: includes findActiveByUserIdAndWord (JOIN + NOT IN)
- CfQueue: thin wrapper around CF Queue producer binding
- All errors wrapped in ResultAsync with domain error types

Refs #11"
```

---

### Task 8: Wire `/add` handler → submitWord → queue (Issue #11)

**Files:**

- Modify: `workers/api/adapters/telegram_webhook.ts` — register `/add` command
- Modify: `workers/api/adapters/telegram_webhook_test.ts` — test wiring
- Modify: `workers/api/index.ts` — build deps and pass to webhook handler

- [ ] **Step 1: Update the webhook adapter to accept deps and register /add**

Replace `workers/api/adapters/telegram_webhook.ts`:

```typescript
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv } from "../../shared/mod.ts";
import { D1CardRepository } from "../../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../../shared/adapters/d1_submission_repository.ts";
import { D1UserRepository } from "../../shared/adapters/d1_user_repository.ts";
import { CfQueue } from "./cf_queue.ts";
import { parseAddCommand } from "../handlers/add_command.ts";
import { submitWord } from "../services/submit_word.ts";

let cachedBotInfo: UserFromGetMe | undefined;

const DEFAULT_TEMPLATE_ID = 1;

export type WebhookOptions = {
  readonly botInfo?: UserFromGetMe;
};

export async function handleWebhook(
  req: Request,
  env: ApiEnv,
  options?: WebhookOptions,
): Promise<Response> {
  const botInfo = options?.botInfo ?? cachedBotInfo;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { botInfo });

  if (botInfo === undefined) {
    await bot.init();
    cachedBotInfo = bot.botInfo;
  }

  const deps = {
    userRepo: new D1UserRepository(env.DB),
    cardRepo: new D1CardRepository(env.DB),
    submissionRepo: new D1SubmissionRepository(env.DB),
    queue: new CfQueue(env.EVENTS),
  };

  bot.command("add", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /add word | sentence");
      return;
    }

    const parsed = parseAddCommand(text);
    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const from = ctx.from;
    if (!from) {
      await ctx.reply("Could not identify user.");
      return;
    }

    const result = await submitWord(
      {
        userId: from.id,
        firstName: from.first_name,
        languageCode: null,
        word: parsed.word,
        sentence: parsed.sentence,
        chatId: String(ctx.chat.id),
        messageId: String(ctx.msg.message_id),
        templateId: DEFAULT_TEMPLATE_ID,
      },
      deps,
    );

    await result.match(
      async (val) => {
        if (val.isNew) {
          await ctx.reply(`⏳ Generating card for "${parsed.word}"...`);
        } else {
          await ctx.reply(`Card for "${parsed.word}" already exists (status: ${val.existingStatus}).`);
        }
      },
      async (err) => {
        console.error({ event: "submit_word_failed", error: err.message, userId: from.id });
        await ctx.reply("Something went wrong. Please try again later.");
      },
    );
  });

  const handler = webhookCallback(bot, "cloudflare-mod");
  return handler(req);
}
```

- [ ] **Step 2: Update the webhook test for /add command**

Replace `workers/api/adapters/telegram_webhook_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handleWebhook } from "./telegram_webhook.ts";
import { makeTelegramUpdate, mockApiEnv, mockBotInfo } from "../test_helpers.ts";

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleWebhook", () => {
  it("should return 200 for a valid Telegram update", async () => {
    const res = await handleWebhook(makeReq(makeTelegramUpdate()), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });

  it("should return 200 for an /add command update", async () => {
    const update = makeTelegramUpdate({
      message: {
        message_id: 1,
        from: { id: 12345, is_bot: false, first_name: "Test" },
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "/add apple | I ate an apple",
        entities: [{ type: "bot_command", offset: 0, length: 4 }],
      },
    });

    // 200 = grammY processed the update. DB calls fail due to mock env,
    // but error handler catches it and replies to user.
    const res = await handleWebhook(makeReq(update), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });
});
```

> **Note:** Full end-to-end testing (D1 + queue) requires miniflare — out of M2 unit test scope.

- [ ] **Step 3: Run tests**

Run: `deno test workers/api/`

Expected: PASS — all tests green. If `bot.init()` causes network issues in tests, apply the `botInfo` injection
workaround described in Task 4 Step 7.

- [ ] **Step 4: Run full check**

Run: `deno task check`

Expected: PASS.

- [ ] **Step 5: Run all project tests**

Run: `deno test`

Expected: PASS — all domain, port, and API tests pass.

- [ ] **Step 6: Commit**

```bash
git add workers/api/adapters/telegram_webhook.ts workers/api/adapters/telegram_webhook_test.ts
git commit -m "feat(api): wire /add command → submitWord service → queue

Full flow: grammY /add command → parseAddCommand → submitWord service
→ D1 repos + CF queue → reply with confirmation or duplicate status.

Closes #11"
```
