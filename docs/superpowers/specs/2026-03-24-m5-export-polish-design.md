# M5: Export & Polish — Design Spec

**Date:** 2026-03-24
**Milestone:** #5 — Export & Polish
**Issues:** #19, #20, #21, #22, #23, #24, #25

## Overview

M5 delivers the Anki export pipeline and polishes the system for end-to-end usability. Users can generate vocabulary cards via Telegram and export them as TSV files for direct Anki import. TTS is handled on the Anki client side, not server-side.

## Design Decisions

- **TTS on client:** Audio generation is not performed server-side. Anki client uses its own TTS API or system TTS at runtime. `audioR2Key` field is retained in schema but deprecated (no writes, ignored on export).
- **Export format:** Pure TSV file sent via Telegram, no ZIP packaging needed.
- **Template-driven:** Card fields, prompts, and schema constraints are stored as configuration in D1 (`card_templates` table), not hardcoded.
- **Language-agnostic:** Templates do not hardcode language pairs. The prompt guides the LLM to infer source/target languages from context.

## §1: Data Model Changes

### 1.1 `users` table — add `activeTemplateId`

```sql
ALTER TABLE users ADD COLUMN active_template_id INTEGER REFERENCES card_templates(id);
```

- Nullable. `NULL` means "use system default template".
- Domain type `User` gains `activeTemplateId: number | null`.
- `submit_word` replaces `DEFAULT_TEMPLATE_ID = 1` with: check `user.activeTemplateId`, fallback to `templateRepo.findDefault()`.
- `activeTemplateId` is **not** part of `upsert`. A separate `UserRepositoryPort.updateActiveTemplate(telegramId: number, templateId: number | null)` method is added for future template switching. `upsert` continues to handle user creation with name and language code only.

### 1.2 `card_templates` — no structural changes

Table structure unchanged. A seed script inserts one default template record (`isActive=true`).

### 1.3 `cards.audioR2Key` — retained but deprecated

Column stays in schema to avoid migration churn. No code writes to it. Export logic ignores it.

## §2: Seed Default Template (Task 22)

### 2.1 Seed script

Create `workers/shared/db/seed.ts`. Register as `deno task db:seed` in `deno.jsonc`.

The seed script connects to the local D1 database via wrangler's local persistence (same mechanism as `deno task dev:api`). Performs `INSERT OR IGNORE` of one default template.

### 2.2 Default template content

**name:** `"Vocabulary"`

**promptTemplate:**
```
You are a language learning assistant. The user is learning vocabulary.

Word: {word}
Context sentence: {sentence}

Based on the word and context, generate a flashcard with:
- The word itself
- Pronunciation/reading in the target language's phonetic system (if applicable)
- Meaning explained in the context language
- An example sentence in the source language
- The same example translated to the target language
- Any helpful notes about usage, etymology, or common mistakes

Respond in JSON matching the provided schema.
```

**responseJsonSchema:**
```json
{
  "type": "object",
  "properties": {
    "word": { "type": "string" },
    "reading": { "type": "string" },
    "meaning": { "type": "string" },
    "example_source": { "type": "string" },
    "example_target": { "type": "string" },
    "notes": { "type": "string" }
  },
  "required": ["word", "reading", "meaning", "example_source", "example_target", "notes"]
}
```

**ankiFieldsMapping:**
```json
{
  "Front": "word",
  "Reading": "reading",
  "Meaning": "meaning",
  "ExampleSource": "example_source",
  "ExampleTarget": "example_target",
  "Notes": "notes"
}
```

**ankiNoteType:** `"Vocabulary"`

### 2.3 TemplateRepositoryPort extensions

New methods:
- `create(template: NewCardTemplate): ResultAsync<CardTemplate, RepositoryError>`
- `findDefault(): ResultAsync<CardTemplate | null, RepositoryError>` — queries first record with `isActive = true`

## §3: Export Core Flow (Tasks 19-21)

### 3.1 `exportCards` pure function (Task 19)

Location: `workers/shared/services/export_cards.ts` (shared layer — pure function on domain types, reusable by both api and processor)

```typescript
type ExportCardsInput = {
  cards: readonly Card[];
  template: CardTemplate;
};

type ExportCardsResult = {
  tsv: string;
  cardIds: readonly number[];
};

function exportCards(input: ExportCardsInput): Result<ExportCardsResult, ExportError>
```

`ExportError` is defined in `shared/domain/errors.ts`: `{ readonly kind: "export"; readonly message: string }`.

Logic:
1. Parse each card's `llmResponseJson`
2. Map fields according to `template.ankiFieldsMapping`
3. Sanitize field values: replace `\t` with spaces, `\n`/`\r` with spaces (LLM output may contain these)
4. Generate TSV: no header row (Anki import doesn't need headers; field order defined by mapping)
5. Return TSV string + exported cardIds
6. Cards with unparseable JSON are skipped, noted in errors

Pure function, no I/O.

### 3.2 `/export` command (Task 20)

Location: `workers/api/handlers/export_command.ts`

Handler orchestration:
```
1. cardRepo.findReadyByUserId(userId) → returns cards with templateId (joined through submissions)
2. No ready cards → reply "No cards ready for export."
3. Group cards by templateId (future-proof; currently all cards share the same template)
4. For each group: templateRepo.findById(templateId) → exportCards(cards, template) → TSV
5. chatNotification.sendFile(chatId, tsv, "anki_export.txt")
6. cardRepo.markExported(cardIds)
```

**Key decisions:**
- **Send first, mark after.** If send fails, cards stay `ready` and user can retry.
- **`markExported` only updates cards with status `ready`** (WHERE clause guard), preventing race conditions.

### 3.3 CardRepositoryPort extensions (Task 21)

New methods:
- `findReadyByUserId(userId: number): ResultAsync<readonly ReadyCard[], RepositoryError>` — joins `cards` with `submissions` to filter by userId and include `templateId`. Returns `ReadyCard = Card & { templateId: number }`.
- `markExported(ids: readonly number[]): ResultAsync<void, RepositoryError>` — batch update status to `exported`, with `WHERE status = 'ready'` guard.

### 3.4 Reuse `ChatNotificationPort` for file sending

The existing `ChatNotificationPort` already declares `sendFile(chatId, file, filename, caption?)`. Rather than creating a separate `FileSenderPort`, the `/export` handler depends on `Pick<ChatNotificationPort, "sendFile">`. The api worker creates its own Telegram adapter implementing `ChatNotificationPort` (the processor already has one). The existing stub `sendFile` implementation is completed.

## §4: Error Handling & Retry (Task 23)

### 4.1 Error classification

```typescript
// shared/domain/errors.ts
type ErrorClassification = "transient" | "permanent";
function classifyError(error: { kind: string; message: string }): ErrorClassification
```

Classification rules by error kind:
- **`llm`**: transient by default (network/rate-limit/5xx); permanent if message contains "schema" or "parse" (invalid LLM output)
- **`repository`**: transient by default (D1 temporary unavailability); permanent if "not found" (missing data)
- **`tts`**: N/A (TTS moved to client)
- **`notification`**: transient (Telegram API errors are retryable)
- **`queue`**: transient (queue delivery issues)

### 4.2 Queue handler behavior

```
message arrives
  → generateCard(cardId)
  → success: msg.ack()
  → failure:
    → classifyError(err)
    → transient: msg.retry()
    → permanent: msg.ack()  // card already marked failed
```

All paths emit structured logs: `{ event, cardId, errorClassification, error }`.

### 4.3 Idempotency guard

`generateCard` checks card status at entry: if already `ready`/`exported`/`failed`, return success immediately. Prevents duplicate processing on retry.

## §5: Plain Text Message Support (Task 24)

### 5.1 Logic

Add `bot.on("message:text", ...)` handler in `telegram_webhook.ts`. Reuse `parseAddCommand` parser.

```
User sends plain text (not a /command)
  → parseAddCommand(text)
  → success: run submitWord flow (same as /add)
  → failure: silent ignore (no reply)
```

### 5.2 Silent on parse failure

Unlike `/add` which replies with usage hint on parse failure, plain text handler is **silent** on failure to avoid responding to unrelated messages.

### 5.3 Registration order

Commands registered first (`bot.command("add")`, `bot.command("export")`, etc.), then `bot.on("message:text")` last as fallback. Command messages do not reach the plain text handler.

## §6: Integration Verification (Task 25)

### 6.1 Automated checks

Must all pass:
- `deno task check` — type-check + lint + format
- `deno test` — all unit tests

### 6.2 Manual smoke test checklist

Requires local `.dev.vars` with real Telegram bot token:

1. `deno task dev:api` starts without errors
2. `deno task dev:processor` starts without errors
3. `/add ephemeral | The beauty was ephemeral` → "Generating..." reply
4. Processor completes → success notification
5. Plain text `resilient | She is resilient` → triggers generation
6. Plain text `hello` → no reply (silent ignore)
7. `/export` → receive TSV file
8. `/export` again → "No cards ready for export."
9. Structured JSON logs visible in wrangler output

### 6.3 Out of scope

- Production deployment (tofu apply)
- Load testing
- Template switching UI (`/template` command)

## File Changes Summary

### New files
- `workers/shared/db/seed.ts` — seed default template
- `workers/shared/services/export_cards.ts` — pure TSV generation function
- `workers/shared/services/export_cards_test.ts` — tests
- `workers/api/handlers/export_command.ts` — /export handler
- `workers/api/handlers/export_command_test.ts` — tests
- `workers/api/adapters/telegram_notification.ts` — ChatNotificationPort impl for api worker

### Modified files
- `workers/shared/db/schema.ts` — users.active_template_id column
- `workers/shared/domain/user.ts` — activeTemplateId field
- `workers/shared/domain/errors.ts` — ExportError, ErrorClassification, classifyError
- `workers/shared/ports/card_repository.ts` — findReadyByUserId, markExported
- `workers/shared/ports/user_repository.ts` — updateActiveTemplate
- `workers/shared/ports/template_repository.ts` — create, findDefault
- `workers/shared/adapters/d1_card_repository.ts` — implement new methods
- `workers/shared/adapters/d1_template_repository.ts` — implement new methods
- `workers/shared/adapters/d1_user_repository.ts` — handle activeTemplateId
- `workers/api/adapters/telegram_webhook.ts` — register /export, plain text handler, replace DEFAULT_TEMPLATE_ID
- `workers/api/services/submit_word.ts` — use user.activeTemplateId with fallback
- `workers/processor/index.ts` — error classification, retry/ack logic, idempotency guard
- `workers/processor/adapters/telegram_notification.ts` — implement sendFile (replace stub)
- `deno.jsonc` — add `db:seed` task
- DB migration (auto-generated via `deno task db:generate`)
