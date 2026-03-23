# M3: Card Generation — Design Spec

## Overview

Implement the processor worker that consumes `generate_card` queue messages, calls an LLM via Cloudflare AI Gateway, and
stores structured card data in D1.

## Issues

| Issue | Title                                        | Dependencies  |
| ----- | -------------------------------------------- | ------------- |
| #12   | Processor queue consumer skeleton            | None          |
| #13   | generateCard service (pure business logic)   | #12           |
| #14   | OpenAI-compatible LLM adapter                | None          |
| #15   | Wire processor queue consumer → generateCard | #12, #13, #14 |

## Data Flow

```
Queue (generate_card message)
  → Processor index.ts (route by message type)
    → generateCard service
      1. CardRepo.findById(cardId) → Card
      2. CardRepo.updateStatus(cardId, "generating")
      3. SubmissionRepo.findById(card.submissionId) → Submission (to resolve templateId)
      4. TemplateRepo.findById(submission.templateId) → CardTemplate
      5. Replace {word}, {sentence} from Card in CardTemplate.promptTemplate → prompt
      6. LlmAdapter.generateStructured(prompt, template.responseJsonSchema) → JSON
      7. JSON.parse + basic non-null check (no full schema validation)
      8. CardRepo.updateStatus(cardId, "ready", { llmResponseJson })
      ── On failure → CardRepo.updateStatus(cardId, "failed", { errorMessage })
  → msg.ack() always (failed cards already marked in D1)
```

### Key Decisions

- **Ack all messages** — failures are recorded in D1, no infinite retries. Retry of failed cards is deferred to a future
  milestone (manual re-queue or scheduled job).
- **Status transitions:** `pending → generating → ready/failed`.
- **Submission status not updated in M3** — single-card scope; aggregation deferred to M4/M5.
- **No full JSON Schema validation** — OpenAI structured output guarantees schema compliance. `JSON.parse` + non-null
  check as defense-in-depth. Ajv can be added later if needed.
- **AI binding removed** — `ProcessorEnv.AI: Ai` (Workers AI binding) replaced with `AI_GATEWAY_URL` + `OPENAI_API_KEY`.
  The project uses external OpenAI API proxied through AI Gateway (HTTP fetch), not Workers AI. If Workers AI is needed
  later, the binding can be re-added.
- **No Zod validation on incoming queue messages** — the producer (API worker) already validates via `QueuePort` types.
  The consumer trusts same-codebase producers.

## Module Design

### #12 — Processor Queue Consumer Skeleton

**File:** `workers/processor/index.ts`

```typescript
export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: ProcessorEnv,
    ctx: ExecutionContext,
  ) {
    for (const msg of batch.messages) {
      switch (msg.body.type) {
        case "generate_card":
          // delegate to generateCard service
          break;
        default:
          console.error({ event: "unknown_message_type", body: msg.body });
      }
      msg.ack();
    }
  },
};
```

- Routes by `QueueMessage.type` (Zod-validated discriminated union).
- Ack every message regardless of outcome.
- Switch/case for future message types.

### #13 — generateCard Service

**File:** `workers/processor/services/generate_card.ts`

```typescript
type GenerateCardDeps = {
  cardRepo: CardRepositoryPort;
  submissionRepo: SubmissionRepositoryPort;
  templateRepo: TemplateRepositoryPort;
  llm: LlmPort;
};

function generateCard(
  cardId: number,
  deps: GenerateCardDeps,
): ResultAsync<void, RepositoryError | LlmError>;
```

- Pure business logic, no env/bindings access.
- All dependencies injected via `deps`.
- Returns `ResultAsync`; errors are `RepositoryError | LlmError`.
- Prompt construction: replace `{word}` and `{sentence}` placeholders in template.

### #14 — OpenAI LLM Adapter

**File:** `workers/processor/adapters/openai_llm.ts`

```typescript
type OpenAiLlmConfig = {
  gatewayUrl: string; // AI Gateway endpoint
  apiKey: string; // OpenAI API key
  model: string; // e.g. "gpt-4o"
  fetchFn?: typeof fetch; // injectable for tests
};

function createOpenAiLlm(config: OpenAiLlmConfig): LlmPort;
```

- Implements existing `LlmPort` interface.
- Uses `response_format: { type: "json_schema", json_schema: ... }` for structured output. The `jsonSchema` string from
  D1 is `JSON.parse`d inside the adapter before sending to OpenAI. Malformed schema in D1 → `LlmError`.
- Injectable `fetchFn` for test mocking; defaults to `globalThis.fetch` in production.
- Maps fetch/HTTP/parse errors to `LlmError`.
- Lives in `workers/processor/adapters/` (not `shared/`) because it is processor-specific. Shared adapters are for
  bindings used by both workers (D1, R2).

### #15 — Wire Processor

**Modify:** `workers/processor/index.ts`

- Construct adapter instances from `env` bindings.
- Call `generateCard(cardId, deps)`.
- Structured JSON logging on success and failure.

## New Components

### TemplateRepositoryPort

**File:** `workers/shared/ports/template_repository.ts`

```typescript
interface TemplateRepositoryPort {
  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError>;
}
```

### D1 Template Repository Adapter

**File:** `workers/shared/adapters/d1_template_repository.ts`

Implements `TemplateRepositoryPort` using Drizzle ORM against the existing `card_templates` table. Follows the same
pattern as `d1_card_repository.ts`.

### LlmPort Interface Change

**File:** `workers/shared/ports/llm.ts`

```typescript
// Before
generateStructured<T>(prompt: string, jsonSchema: string): ResultAsync<T, LlmError>;

// After
generateStructured(prompt: string, jsonSchema: string): ResultAsync<unknown, LlmError>;
```

Remove generic `<T>` — runtime cannot verify the type. Return `unknown`; callers `JSON.stringify` the result into
`llmResponseJson`.

### ProcessorEnv Change

**File:** `workers/shared/env.ts`

```typescript
// Before
export interface ProcessorEnv extends BaseEnv {
  readonly AI: Ai;
  readonly TTS_API_URL: string;
  readonly TTS_API_KEY: string;
}

// After
export interface ProcessorEnv extends BaseEnv {
  readonly AI_GATEWAY_URL: string; // AI Gateway endpoint URL
  readonly OPENAI_API_KEY: string; // OpenAI API key
  readonly LLM_MODEL: string; // Model name (e.g. "gpt-4o")
  readonly TTS_API_URL: string; // Retained for M4
  readonly TTS_API_KEY: string; // Retained for M4
}
```

## Error Handling

### generateCard Service Errors

| Scenario                      | Handling                   | Card Status           |
| ----------------------------- | -------------------------- | --------------------- |
| cardId not found              | Log + return err           | Unchanged             |
| Submission/template not found | Log + mark failed          | `failed`              |
| LLM call fails (network/API)  | Mark failed + errorMessage | `failed`              |
| LLM returns invalid JSON      | Mark failed + errorMessage | `failed`              |
| DB update fails               | Log + return err           | May stay `generating` |

### LLM Adapter Errors

| Scenario                        | Maps To                                  |
| ------------------------------- | ---------------------------------------- |
| Fetch failure (network)         | `LlmError`                               |
| HTTP non-200                    | `LlmError` (with status + body)          |
| Response JSON.parse failure     | `LlmError`                               |
| D1 jsonSchema is malformed JSON | `LlmError` (parse error before API call) |

### Structured Logging

```typescript
console.log({ event: "queue_message_received", type: msg.body.type, cardId });
console.log({ event: "card_generated", cardId, durationMs });
console.error({ event: "card_generation_failed", cardId, error: err.message });
```

## Testing Strategy

### #12 — Processor Skeleton

- Exported object has a `queue` function.
- Unknown message type does not throw; acks normally.

### #13 — generateCard Service

- All deps mocked (CardRepo, SubmissionRepo, TemplateRepo, Llm).
- Scenarios:
  - Happy path: card → submission → template → LLM → status `ready`.
  - Card not found → error returned.
  - LLM failure → status `failed` + errorMessage.
  - Verify status transition order: `generating` set before LLM call, `ready`/`failed` after.

### #14 — OpenAI LLM Adapter

- Inject mock `fetchFn`.
- Verify request shape (URL, headers, body with `response_format`).
- Verify successful response parsing.
- HTTP error → `LlmError`.
- JSON parse failure → `LlmError`.

### #15 — Wire (Integration)

- Full deps with mocks; verify queue handler calls generateCard end-to-end.

### TemplateRepository Adapter

- Same style as existing D1 repo adapter tests (mock Drizzle query builder).

## Implementation Order

1. **#12** — Processor skeleton + tests
2. **#13** — generateCard service + TemplateRepositoryPort + D1 adapter + `shared/mod.ts` export + tests
3. **#14** — OpenAI LLM adapter + LlmPort change + ProcessorEnv change + tests
4. **#15** — Wire everything + integration test + structured logging
