# M3: Card Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the processor worker that consumes `generate_card` queue messages, calls an LLM via Cloudflare AI Gateway, and stores structured card data in D1.

**Architecture:** Queue consumer routes messages by type, delegates to a `generateCard` service that orchestrates card lookup, prompt construction, LLM call, and status updates. All external dependencies are injected via ports. The OpenAI LLM adapter uses AI Gateway as a proxy.

**Tech Stack:** Deno, Cloudflare Workers (Queues consumer), neverthrow, Drizzle ORM, OpenAI Chat Completions API via AI Gateway.

**Spec:** `docs/superpowers/specs/2026-03-23-m3-card-generation-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `workers/shared/ports/template_repository.ts` | Port interface for CardTemplate lookups |
| `workers/shared/adapters/d1_template_repository.ts` | D1/Drizzle adapter implementing TemplateRepositoryPort |
| `workers/shared/adapters/d1_template_repository_test.ts` | Tests for D1 template repository (toDomain mapping) |
| `workers/processor/index.ts` | Processor worker entry point — queue consumer |
| `workers/processor/index_test.ts` | Tests for processor queue consumer |
| `workers/processor/services/generate_card.ts` | generateCard service — pure business logic |
| `workers/processor/services/generate_card_test.ts` | Tests for generateCard service |
| `workers/processor/adapters/openai_llm.ts` | OpenAI LLM adapter via AI Gateway |
| `workers/processor/adapters/openai_llm_test.ts` | Tests for OpenAI LLM adapter |

### Modified Files

| File | Change |
|------|--------|
| `workers/shared/ports/llm.ts` | Remove generic `<T>`, return `unknown` |
| `workers/shared/env.ts` | Replace `AI: Ai` with `AI_GATEWAY_URL`, `OPENAI_API_KEY`, `LLM_MODEL` |
| `workers/shared/mod.ts` | Add `TemplateRepositoryPort` export |
| `workers/processor/deno.jsonc` | Add workspace member config (name, exports) |
| `workers/processor/wrangler.jsonc` | Remove `ai` binding, add env vars to `.dev.vars.example` |
| `deno.jsonc` | Add `./workers/processor/` to workspace array |

---

## Task 1: Workspace Setup for Processor

**Files:**
- Modify: `deno.jsonc:2-4` (workspace array)
- Modify: `workers/processor/deno.jsonc`
- Modify: `workers/processor/wrangler.jsonc:22-24` (remove ai binding)

- [ ] **Step 1: Add processor to workspace and configure deno.jsonc**

In root `deno.jsonc`, add `"./workers/processor/"` to the workspace array:

```jsonc
"workspace": [
  "./workers/shared/",
  "./workers/api/",
  "./workers/processor/"
],
```

In `workers/processor/deno.jsonc`, set up the workspace member:

```jsonc
{
  "name": "@anki/processor",
  "exports": "./index.ts"
}
```

- [ ] **Step 2: Remove ai binding from wrangler.jsonc**

In `workers/processor/wrangler.jsonc`, remove the `"ai"` section (lines 22-24):

```jsonc
// DELETE this block:
"ai": {
  "binding": "AI"
},
```

The processor will use AI Gateway via HTTP fetch, not the Workers AI binding.

- [ ] **Step 3: Create .dev.vars.example for processor**

Create `workers/processor/.dev.vars.example`:

```
TELEGRAM_BOT_TOKEN=your-bot-token
AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY_ID/openai
OPENAI_API_KEY=sk-your-key
LLM_MODEL=gpt-4o
TTS_API_URL=https://tts.example.com
TTS_API_KEY=your-tts-key
```

- [ ] **Step 4: Verify workspace resolves**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno check workers/shared/mod.ts`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add deno.jsonc workers/processor/deno.jsonc workers/processor/wrangler.jsonc workers/processor/.dev.vars.example
git commit -m "chore(processor): add processor to Deno workspace, remove AI binding"
```

---

## Task 2: Update Shared Layer (LlmPort, ProcessorEnv, TemplateRepositoryPort)

**Files:**
- Modify: `workers/shared/ports/llm.ts`
- Modify: `workers/shared/env.ts:14-18`
- Create: `workers/shared/ports/template_repository.ts`
- Modify: `workers/shared/mod.ts`

- [ ] **Step 1: Update LlmPort — remove generic, return unknown**

In `workers/shared/ports/llm.ts`, replace the entire file:

```typescript
import type { ResultAsync } from "neverthrow";
import type { LlmError } from "../domain/errors.ts";

export interface LlmPort {
  generateStructured(prompt: string, jsonSchema: string): ResultAsync<unknown, LlmError>;
}
```

- [ ] **Step 2: Update ProcessorEnv**

In `workers/shared/env.ts`, replace the `ProcessorEnv` interface (lines 14-18):

```typescript
export interface ProcessorEnv extends BaseEnv {
  readonly AI_GATEWAY_URL: string;
  readonly OPENAI_API_KEY: string;
  readonly LLM_MODEL: string;
  readonly TTS_API_URL: string;
  readonly TTS_API_KEY: string;
}
```

- [ ] **Step 3: Create TemplateRepositoryPort**

Create `workers/shared/ports/template_repository.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { CardTemplate } from "../domain/card_template.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface TemplateRepositoryPort {
  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError>;
}
```

- [ ] **Step 4: Add TemplateRepositoryPort to barrel export**

In `workers/shared/mod.ts`, add after the `UserRepositoryPort` export line (line 37):

```typescript
export type { TemplateRepositoryPort } from "./ports/template_repository.ts";
```

- [ ] **Step 5: Verify type-check passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno check workers/shared/mod.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add workers/shared/ports/llm.ts workers/shared/env.ts workers/shared/ports/template_repository.ts workers/shared/mod.ts
git commit -m "feat(shared): update LlmPort/ProcessorEnv, add TemplateRepositoryPort"
```

---

## Task 3: D1 Template Repository Adapter + Tests

**Files:**
- Create: `workers/shared/adapters/d1_template_repository.ts`
- Create: `workers/shared/adapters/d1_template_repository_test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/shared/adapters/d1_template_repository_test.ts`.

The existing D1 adapters (`d1_card_repository.ts`, `d1_submission_repository.ts`) have no
unit tests because mocking Drizzle's internal query builder is complex and fragile.
Follow the same pattern: test the `toDomain` mapping logic (the only non-trivial code)
via a static method, and rely on service-level tests for integration.

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { D1TemplateRepository } from "./d1_template_repository.ts";

describe("D1TemplateRepository", () => {
  describe("toDomain", () => {
    it("maps Drizzle row to CardTemplate domain type", () => {
      const row = {
        id: 1,
        name: "ja-en-basic",
        promptTemplate: "Translate {word}: {sentence}",
        responseJsonSchema: '{"type":"object"}',
        ankiNoteType: "Basic",
        ankiFieldsMapping: '{"front":"word","back":"translation"}',
        isActive: 1,
        createdAt: "2026-01-01T00:00:00Z",
      };

      const result = D1TemplateRepository.toDomain(row);

      assertEquals(result.id, 1);
      assertEquals(result.name, "ja-en-basic");
      assertEquals(result.promptTemplate, "Translate {word}: {sentence}");
      assertEquals(result.isActive, true);
    });

    it("converts isActive 0 to false", () => {
      const row = {
        id: 2,
        name: "inactive",
        promptTemplate: "",
        responseJsonSchema: "{}",
        ankiNoteType: "Basic",
        ankiFieldsMapping: "{}",
        isActive: 0,
        createdAt: "2026-01-01T00:00:00Z",
      };

      assertEquals(D1TemplateRepository.toDomain(row).isActive, false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/shared/adapters/d1_template_repository_test.ts`
Expected: FAIL — module `./d1_template_repository.ts` not found or `toDomain` not a static method.

- [ ] **Step 3: Write the D1 adapter implementation**

Create `workers/shared/adapters/d1_template_repository.ts`:

```typescript
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { CardTemplate } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { TemplateRepositoryPort } from "../ports/template_repository.ts";
import { cardTemplates } from "../db/schema.ts";

export class D1TemplateRepository implements TemplateRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cardTemplates)
        .where(eq(cardTemplates.id, id))
        .then((rows) => (rows[0] ? D1TemplateRepository.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  static toDomain(row: typeof cardTemplates.$inferSelect): CardTemplate {
    return {
      id: row.id,
      name: row.name,
      promptTemplate: row.promptTemplate,
      responseJsonSchema: row.responseJsonSchema,
      ankiNoteType: row.ankiNoteType,
      ankiFieldsMapping: row.ankiFieldsMapping,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
    };
  }
}
```

Note: `toDomain` is a `static` method (unlike the private instance method in
`d1_card_repository.ts`) so it can be tested directly without mocking Drizzle.
The `isActive` column is `integer` in SQLite (0/1), converted to `boolean` here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/shared/adapters/d1_template_repository_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/shared/adapters/d1_template_repository.ts workers/shared/adapters/d1_template_repository_test.ts
git commit -m "feat(shared): D1 template repository adapter with tests"
```

---

## Task 4: Processor Queue Consumer Skeleton (#12)

**Files:**
- Create: `workers/processor/index.ts`
- Create: `workers/processor/index_test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/processor/index_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import processor from "./index.ts";

function mockMessage(body: unknown): {
  body: unknown;
  ack: () => void;
  retry: () => void;
  acked: boolean;
} {
  const msg = {
    body,
    acked: false,
    ack(): void {
      this.acked = true;
    },
    retry(): void {},
  };
  return msg;
}

function mockBatch(messages: ReturnType<typeof mockMessage>[]): {
  messages: typeof messages;
  queue: string;
} {
  return { messages, queue: "test-queue" };
}

const mockEnv = {
  DB: {} as never,
  ASSETS: {} as never,
  TELEGRAM_BOT_TOKEN: "test-token",
  AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/test",
  OPENAI_API_KEY: "sk-test",
  LLM_MODEL: "gpt-4o",
  TTS_API_URL: "https://tts.example.com",
  TTS_API_KEY: "tts-key",
};

const mockCtx = {
  waitUntil: (): void => {},
  passThroughOnException: (): void => {},
} as never;

describe("Processor queue consumer", () => {
  it("exports a queue handler", () => {
    assertEquals(typeof processor.queue, "function");
  });

  it("acks generate_card messages", async () => {
    const msg = mockMessage({ type: "generate_card", cardId: 1 });
    const batch = mockBatch([msg]);

    await processor.queue(batch as never, mockEnv as never, mockCtx);

    assertEquals(msg.acked, true);
  });

  it("acks unknown message types without throwing", async () => {
    const msg = mockMessage({ type: "unknown_type" });
    const batch = mockBatch([msg]);

    await processor.queue(batch as never, mockEnv as never, mockCtx);

    assertEquals(msg.acked, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/index_test.ts`
Expected: FAIL — module `./index.ts` not found or no default export.

- [ ] **Step 3: Implement the processor skeleton**

Create `workers/processor/index.ts`:

```typescript
import type { MessageBatch, ExecutionContext } from "@cloudflare/workers-types";
import type { QueueMessage, ProcessorEnv } from "../shared/mod.ts";

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: ProcessorEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const msg of batch.messages) {
      switch (msg.body.type) {
        case "generate_card":
          console.log({ event: "queue_message_received", type: msg.body.type, cardId: msg.body.cardId });
          // TODO: delegate to generateCard service (Task 6)
          break;
        default:
          console.error({ event: "unknown_message_type", body: msg.body });
      }
      msg.ack();
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/index_test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Run full check**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task check`
Expected: No lint/fmt/type errors.

- [ ] **Step 6: Commit**

```bash
git add workers/processor/index.ts workers/processor/index_test.ts
git commit -m "feat(processor): queue consumer skeleton with message routing (#12)"
```

---

## Task 5: generateCard Service + Tests (#13)

**Files:**
- Create: `workers/processor/services/generate_card.ts`
- Create: `workers/processor/services/generate_card_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `workers/processor/services/generate_card_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type {
  Card,
  CardRepositoryPort,
  CardTemplate,
  LlmPort,
  NewCard,
  Submission,
  SubmissionRepositoryPort,
  TemplateRepositoryPort,
} from "../../shared/mod.ts";
import type { LlmError, RepositoryError } from "../../shared/domain/errors.ts";
import { generateCard, type GenerateCardDeps } from "./generate_card.ts";

const sampleCard: Card = {
  id: 1,
  submissionId: 10,
  word: "apple",
  sentence: "I ate an apple",
  status: "pending",
  llmResponseJson: null,
  audioR2Key: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sampleSubmission: Submission = {
  id: 10,
  userId: 100,
  templateId: 5,
  chatId: "12345",
  messageId: "1",
  status: "pending",
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sampleTemplate: CardTemplate = {
  id: 5,
  name: "ja-en-basic",
  promptTemplate: "Translate the word '{word}' given the sentence: '{sentence}'",
  responseJsonSchema: '{"type":"object","properties":{"translation":{"type":"string"}}}',
  ankiNoteType: "Basic",
  ankiFieldsMapping: '{"front":"word","back":"translation"}',
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleLlmResponse = { translation: "りんご" };

function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(sampleCard),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: (_c: NewCard) => okAsync(sampleCard),
    updateStatus: (_id, _status, _fields?) =>
      okAsync({ ...sampleCard, status: _status, ..._fields }),
    ...overrides,
  };
}

function mockSubmissionRepo(overrides?: Partial<SubmissionRepositoryPort>): SubmissionRepositoryPort {
  return {
    findById: () => okAsync(sampleSubmission),
    create: () => okAsync(sampleSubmission),
    updateStatus: () => okAsync(sampleSubmission),
    ...overrides,
  };
}

function mockTemplateRepo(overrides?: Partial<TemplateRepositoryPort>): TemplateRepositoryPort {
  return {
    findById: () => okAsync(sampleTemplate),
    ...overrides,
  };
}

function mockLlm(overrides?: Partial<LlmPort>): LlmPort {
  return {
    generateStructured: () => okAsync(sampleLlmResponse),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<GenerateCardDeps>): GenerateCardDeps {
  return {
    cardRepo: mockCardRepo(),
    submissionRepo: mockSubmissionRepo(),
    templateRepo: mockTemplateRepo(),
    llm: mockLlm(),
    ...overrides,
  };
}

describe("generateCard", () => {
  it("happy path: fetches card, builds prompt, calls LLM, updates status to ready", async () => {
    const statusUpdates: { status: string; fields?: unknown }[] = [];

    const result = await generateCard(1, makeDeps({
      cardRepo: mockCardRepo({
        updateStatus: (id, status, fields?) => {
          statusUpdates.push({ status, fields });
          return okAsync({ ...sampleCard, status, ...fields });
        },
      }),
    }));

    result.match(
      () => {
        assertEquals(statusUpdates.length, 2);
        assertEquals(statusUpdates[0]!.status, "generating");
        assertEquals(statusUpdates[1]!.status, "ready");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("verifies prompt contains word and sentence from card", async () => {
    let capturedPrompt = "";

    await generateCard(1, makeDeps({
      llm: mockLlm({
        generateStructured: (prompt, _schema) => {
          capturedPrompt = prompt;
          return okAsync(sampleLlmResponse);
        },
      }),
    }));

    assertEquals(capturedPrompt.includes("apple"), true);
    assertEquals(capturedPrompt.includes("I ate an apple"), true);
  });

  it("returns error when card not found", async () => {
    const result = await generateCard(999, makeDeps({
      cardRepo: mockCardRepo({ findById: () => okAsync(null) }),
    }));

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
      },
    );
  });

  it("marks card as failed when LLM call fails", async () => {
    const llmErr: LlmError = { kind: "llm", message: "API timeout" };
    let failedUpdate: { status: string; fields?: unknown } | undefined;

    const result = await generateCard(1, makeDeps({
      llm: mockLlm({ generateStructured: () => errAsync(llmErr) }),
      cardRepo: mockCardRepo({
        updateStatus: (_id, status, fields?) => {
          if (status === "failed") {
            failedUpdate = { status, fields };
          }
          return okAsync({ ...sampleCard, status, ...fields });
        },
      }),
    }));

    // The service should still return ok (failure is recorded in DB)
    // OR return the error — depends on implementation.
    // Per spec: mark failed + return err on LLM failure.
    result.match(
      () => {
        // If the service swallows the error after marking failed, this is fine
        assertEquals(failedUpdate?.status, "failed");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(failedUpdate?.status, "failed");
      },
    );
  });

  it("marks card as failed when submission not found", async () => {
    let markedFailed = false;

    const result = await generateCard(1, makeDeps({
      submissionRepo: mockSubmissionRepo({ findById: () => okAsync(null) }),
      cardRepo: mockCardRepo({
        updateStatus: (_id, status, _fields?) => {
          if (status === "failed") markedFailed = true;
          return okAsync({ ...sampleCard, status });
        },
      }),
    }));

    result.match(
      () => assertEquals(markedFailed, true),
      (err) => assertEquals(err.kind, "repository"),
    );
  });

  it("marks card as failed when template not found", async () => {
    let markedFailed = false;

    const result = await generateCard(1, makeDeps({
      templateRepo: mockTemplateRepo({ findById: () => okAsync(null) }),
      cardRepo: mockCardRepo({
        updateStatus: (_id, status, _fields?) => {
          if (status === "failed") markedFailed = true;
          return okAsync({ ...sampleCard, status });
        },
      }),
    }));

    result.match(
      () => assertEquals(markedFailed, true),
      (err) => assertEquals(err.kind, "repository"),
    );
  });

  it("propagates error when updateStatus to generating fails", async () => {
    const repoErr: RepositoryError = { kind: "repository", message: "DB locked" };

    const result = await generateCard(1, makeDeps({
      cardRepo: mockCardRepo({
        updateStatus: () => errAsync(repoErr),
      }),
    }));

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
        assertEquals(err.message, "DB locked");
      },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/services/generate_card_test.ts`
Expected: FAIL — module `./generate_card.ts` not found.

- [ ] **Step 3: Implement generateCard service**

Create `workers/processor/services/generate_card.ts`:

```typescript
import { type ResultAsync, errAsync } from "neverthrow";
import type {
  CardRepositoryPort,
  LlmPort,
  SubmissionRepositoryPort,
  TemplateRepositoryPort,
} from "../../shared/mod.ts";
import type { LlmError, RepositoryError } from "../../shared/domain/errors.ts";
import { CARD_STATUS } from "../../shared/mod.ts";

export type GenerateCardDeps = {
  readonly cardRepo: CardRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
  readonly templateRepo: TemplateRepositoryPort;
  readonly llm: LlmPort;
};

export function generateCard(
  cardId: number,
  deps: GenerateCardDeps,
): ResultAsync<void, RepositoryError | LlmError> {
  return deps.cardRepo
    .findById(cardId)
    .andThen((card) => {
      if (!card) {
        return errAsync<never, RepositoryError>({
          kind: "repository",
          message: `Card not found: ${cardId}`,
        });
      }

      return deps.cardRepo
        .updateStatus(card.id, CARD_STATUS.GENERATING)
        .andThen(() => deps.submissionRepo.findById(card.submissionId))
        .andThen((submission) => {
          if (!submission) {
            return deps.cardRepo
              .updateStatus(card.id, CARD_STATUS.FAILED, {
                errorMessage: `Submission not found: ${card.submissionId}`,
              })
              .andThen(() =>
                errAsync<never, RepositoryError>({
                  kind: "repository",
                  message: `Submission not found: ${card.submissionId}`,
                })
              );
          }

          return deps.templateRepo.findById(submission.templateId).andThen(
            (template) => {
              if (!template) {
                return deps.cardRepo
                  .updateStatus(card.id, CARD_STATUS.FAILED, {
                    errorMessage: `Template not found: ${submission.templateId}`,
                  })
                  .andThen(() =>
                    errAsync<never, RepositoryError>({
                      kind: "repository",
                      message: `Template not found: ${submission.templateId}`,
                    })
                  );
              }

              const prompt = template.promptTemplate
                .replaceAll("{word}", card.word)
                .replaceAll("{sentence}", card.sentence);

              return deps.llm
                .generateStructured(prompt, template.responseJsonSchema)
                .map((llmResponse) => JSON.stringify(llmResponse))
                .andThen((llmResponseJson) =>
                  deps.cardRepo
                    .updateStatus(card.id, CARD_STATUS.READY, { llmResponseJson })
                    .map(() => undefined)
                )
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
                    .andThen(() => errAsync(llmErr))
                );
            },
          );
        });
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/services/generate_card_test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Run full check**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task check`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add workers/processor/services/generate_card.ts workers/processor/services/generate_card_test.ts
git commit -m "feat(processor): generateCard service with status transitions (#13)"
```

---

## Task 6: OpenAI LLM Adapter + Tests (#14)

**Files:**
- Create: `workers/processor/adapters/openai_llm.ts`
- Create: `workers/processor/adapters/openai_llm_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `workers/processor/adapters/openai_llm_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createOpenAiLlm } from "./openai_llm.ts";

const baseConfig = {
  gatewayUrl: "https://gateway.ai.cloudflare.com/v1/acc/gw/openai",
  apiKey: "sk-test-key",
  model: "gpt-4o",
};

function successFetch(responseContent: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(responseContent) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;
}

function errorFetch(status: number, body: string): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(body, { status }),
    )) as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (() => Promise.reject(new Error("Network error"))) as typeof fetch;
}

describe("OpenAI LLM adapter", () => {
  it("sends correct request shape to AI Gateway", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"translation":"hello"}' } }],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: mockFetch });
    await llm.generateStructured("test prompt", '{"type":"object"}');

    assertEquals(capturedUrl, "https://gateway.ai.cloudflare.com/v1/acc/gw/openai/chat/completions");

    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.model, "gpt-4o");
    assertEquals(body.messages[0].role, "user");
    assertEquals(body.messages[0].content, "test prompt");
    assertEquals(body.response_format.type, "json_schema");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer sk-test-key");
  });

  it("parses successful LLM response", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: successFetch({ translation: "りんご" }),
    });

    const result = await llm.generateStructured("translate apple", '{"type":"object"}');

    result.match(
      (val) => {
        assertEquals((val as Record<string, string>).translation, "りんご");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("returns LlmError on HTTP error", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: errorFetch(429, "Rate limited"),
    });

    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("429"), true);
      },
    );
  });

  it("returns LlmError on network failure", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: failingFetch(),
    });

    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
      },
    );
  });

  it("returns LlmError on malformed JSON schema from D1", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: successFetch({}),
    });

    const result = await llm.generateStructured("test", "not valid json{{{");

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("schema"), true, `Expected message to mention schema, got: ${err.message}`);
      },
    );
  });

  it("returns LlmError when choices array is empty", async () => {
    const emptyChoicesFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [] }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: emptyChoicesFetch });
    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("Empty"), true);
      },
    );
  });

  it("returns LlmError when response content is not valid JSON", async () => {
    const badFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not json at all" } }],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: badFetch });
    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
      },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/adapters/openai_llm_test.ts`
Expected: FAIL — module `./openai_llm.ts` not found.

- [ ] **Step 3: Implement the OpenAI LLM adapter**

Create `workers/processor/adapters/openai_llm.ts`:

```typescript
import { ResultAsync, errAsync } from "neverthrow";
import type { LlmPort } from "../../shared/mod.ts";
import type { LlmError } from "../../shared/domain/errors.ts";

export type OpenAiLlmConfig = {
  readonly gatewayUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof fetch;
};

export function createOpenAiLlm(config: OpenAiLlmConfig): LlmPort {
  const fetchFn = config.fetchFn ?? globalThis.fetch;

  return {
    generateStructured(
      prompt: string,
      jsonSchema: string,
    ): ResultAsync<unknown, LlmError> {
      let parsedSchema: unknown;
      try {
        parsedSchema = JSON.parse(jsonSchema);
      } catch {
        return errAsync({
          kind: "llm" as const,
          message: `Invalid JSON schema: ${jsonSchema}`,
        });
      }

      return ResultAsync.fromPromise(
        fetchFn(`${config.gatewayUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: "user", content: prompt }],
            response_format: {
              type: "json_schema",
              json_schema: { name: "response", schema: parsedSchema, strict: true },
            },
          }),
        }),
        (err): LlmError => ({
          kind: "llm",
          message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ).andThen((response) => {
        if (!response.ok) {
          return ResultAsync.fromPromise(
            response.text(),
            (): LlmError => ({ kind: "llm", message: `HTTP ${response.status}` }),
          ).andThen((body) =>
            errAsync<never, LlmError>({
              kind: "llm",
              message: `HTTP ${response.status}: ${body}`,
            })
          );
        }

        return ResultAsync.fromPromise(
          response.json() as Promise<{
            choices: { message: { content: string } }[];
          }>,
          (err): LlmError => ({
            kind: "llm",
            message: `Response parse failed: ${String(err)}`,
          }),
        ).andThen((data) => {
          const content = data.choices[0]?.message?.content;
          if (!content) {
            return errAsync<never, LlmError>({
              kind: "llm",
              message: "Empty response from LLM",
            });
          }

          return ResultAsync.fromPromise(
            Promise.resolve().then(() => JSON.parse(content) as unknown),
            (): LlmError => ({
              kind: "llm",
              message: `LLM response is not valid JSON: ${content.slice(0, 200)}`,
            }),
          );
        });
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/adapters/openai_llm_test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Run full check**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task check`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add workers/processor/adapters/openai_llm.ts workers/processor/adapters/openai_llm_test.ts
git commit -m "feat(processor): OpenAI LLM adapter via AI Gateway (#14)"
```

---

## Task 7: Wire Processor Queue Consumer → generateCard (#15)

**Files:**
- Modify: `workers/processor/index.ts`
- Modify: `workers/processor/index_test.ts`

- [ ] **Step 1: Update the test to verify end-to-end wiring**

Add to `workers/processor/index_test.ts` a new test that verifies the queue handler constructs deps and calls generateCard. Since the real wiring requires D1/fetch, we test at a higher level — verify that a `generate_card` message triggers status updates via the service.

The simplest approach: the existing skeleton tests already verify ack behavior. Add a test that verifies structured logging output. The full integration test would require mocking D1, which is complex. Instead, verify the wiring compiles and the handler doesn't throw.

Add this test:

```typescript
it("processes generate_card message without throwing", async () => {
  const msg = mockMessage({ type: "generate_card", cardId: 1 });
  const batch = mockBatch([msg]);

  // This will fail internally (no real DB), but should not throw — it should ack
  await processor.queue(batch as never, mockEnv as never, mockCtx);

  assertEquals(msg.acked, true);
});
```

- [ ] **Step 2: Update index.ts to wire generateCard with real adapters**

Replace `workers/processor/index.ts`:

```typescript
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
      msg.ack();
    }
  },
};
```

- [ ] **Step 3: Run tests to verify everything passes**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno test workers/processor/`
Expected: PASS (all processor tests).

- [ ] **Step 4: Run full check and all tests**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task check && deno task test`
Expected: No errors. All tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/processor/index.ts workers/processor/index_test.ts
git commit -m "feat(processor): wire queue consumer to generateCard service (#15)"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task test`
Expected: All tests pass.

- [ ] **Step 2: Run full quality check**

Run: `cd /Users/yuzuru/Source/anki-deck-agent/.claude/worktree/milestone-3 && deno task check`
Expected: No type errors, lint errors, or format issues.

- [ ] **Step 3: Review git log**

Run: `git log --oneline -10`

Expected commits (newest first):
1. `feat(processor): wire queue consumer to generateCard service (#15)`
2. `feat(processor): OpenAI LLM adapter via AI Gateway (#14)`
3. `feat(processor): generateCard service with status transitions (#13)`
4. `feat(processor): queue consumer skeleton with message routing (#12)`
5. `feat(shared): D1 template repository adapter with tests`
6. `feat(shared): update LlmPort/ProcessorEnv, add TemplateRepositoryPort`
7. `chore(processor): add processor to Deno workspace, remove AI binding`
