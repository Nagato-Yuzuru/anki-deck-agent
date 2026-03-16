# M1: Shared Layer — Design Spec

**Date:** 2026-03-16 **Milestone:** M1: Shared Layer **Branch:** `milestone-1` **Issues:** #1–#6

## Overview

Restructure the shared layer from a deck-centric model (`User → Deck → Card[]`) to a submission-centric model
(`User → Submission → Card[]`). Add port interfaces for LLM, TTS, chat notifications, and repositories. All changes are
pre-production — no backward compatibility required.

## Key Design Decisions

| Decision             | Choice                                            | Rationale                                                                                  |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Grouping entity name | `Submission` (not `Deck`)                         | "Deck" in Anki means "a group of cards"; "Submission" accurately describes the user action |
| Chat field naming    | Generic `chatId` / `messageId` (text)             | Notification layer uses Vercel Chat SDK abstraction, not Telegram-specific                 |
| Queue granularity    | Per-card (`GenerateCardMessage`)                  | LLM + TTS are per-card ops; failure isolation; natural parallelism                         |
| LLM response storage | `llmResponseJson` in D1                           | Typical size 1–5 KB; D1 handles this easily; R2 would add unnecessary complexity           |
| LLM SDK              | Cloudflare Workers AI binding (`Ai`)              | Deployment unlikely to change; native binding avoids extra deps                            |
| Notification SDK     | Vercel Chat SDK                                   | Platform-agnostic abstraction over Telegram and future transports                          |
| Error modeling       | Typed error kinds with `neverthrow` `ResultAsync` | Per CLAUDE.md conventions; handler layer calls `.match()` to convert                       |
| Status rename        | `SYNCED` → `EXPORTED`                             | `EXPORTED` = packaged into .apkg file; `SYNCED` implied AnkiConnect push (not in scope)    |
| Env split            | API and processor have different `Env` shapes     | API produces queue messages; processor consumes them + uses AI/TTS bindings                |

## 1. Domain Types

### 1.1 CardStatus (`workers/shared/domain/card_status.ts`)

```
PENDING → GENERATING → READY → EXPORTED | FAILED
```

5 states. Removes `SYNCED` (implied AnkiConnect push, not in scope), adds `GENERATING`, `EXPORTED`, `FAILED`.

### 1.2 SubmissionStatus (`workers/shared/domain/submission_status.ts` — new)

```
PENDING → PROCESSING → DONE | FAILED
```

4 states. Same values as the old `DeckStatus` — this is intentional reuse; only the name changes. Same `as const`
pattern as CardStatus.

### 1.3 Submission (`workers/shared/domain/submission.ts` — new)

```typescript
export type Submission = {
  readonly id: number;
  readonly userId: number;
  readonly templateId: number;
  readonly chatId: string;
  readonly messageId: string;
  readonly status: SubmissionStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

`chatId` and `messageId` are `string` (not `number`) for chat-SDK-agnosticism. When the Telegram adapter receives
numeric IDs, it converts them to strings at the adapter boundary. All coercion happens in adapters, never in
service/domain code.

### 1.4 Card (`workers/shared/domain/card.ts` — updated)

```typescript
export type Card = {
  readonly id: number;
  readonly submissionId: number;
  readonly word: string;
  readonly sentence: string;
  readonly status: CardStatus;
  readonly llmResponseJson: string | null;
  readonly audioR2Key: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

Note: `updatedAt` added to Card (not in original brainstorming) — cards transition through multiple statuses
(`PENDING → GENERATING → READY/FAILED`), and `updatedAt` enables observability (e.g., time spent in `GENERATING`).

### 1.5 Error Types (`workers/shared/domain/errors.ts` — new)

```typescript
export type LlmError = { readonly kind: "llm"; readonly message: string };
export type TtsError = { readonly kind: "tts"; readonly message: string };
export type NotificationError = { readonly kind: "notification"; readonly message: string };
export type RepositoryError = { readonly kind: "repository"; readonly message: string };
export type QueueError = { readonly kind: "queue"; readonly message: string };
```

### 1.6 Domain-Level Insert Types (`workers/shared/domain/` — new)

Port interfaces must not depend on Drizzle types (hexagonal: `shared/ports` imports domain only). Define domain-level
creation types:

```typescript
// In submission.ts
export type NewSubmission = Omit<Submission, "id" | "status" | "errorMessage" | "createdAt" | "updatedAt">;

// In card.ts
export type NewCard = Omit<
  Card,
  "id" | "status" | "llmResponseJson" | "audioR2Key" | "errorMessage" | "createdAt" | "updatedAt"
>;
```

```typescript
// In user.ts
export type NewUser = Omit<User, "createdAt">;
```

Repository adapters (Drizzle implementations) convert these to `InsertCard` / `InsertSubmission` / `InsertUser`
internally.

### 1.7 Domain-Level Update Types

Narrow update types to prevent mutation of immutable fields:

```typescript
// In card.ts
export type CardUpdateFields = Partial<Pick<Card, "llmResponseJson" | "audioR2Key" | "errorMessage">>;

// In submission.ts
export type SubmissionUpdateFields = Partial<Pick<Submission, "errorMessage">>;
```

### 1.8 Deletions

- `workers/shared/domain/deck.ts`
- `workers/shared/domain/deck_status.ts`
- `workers/shared/domain/deck_status_test.ts`

## 2. D1 Schema (Drizzle)

### 2.1 Remove `decks` table

### 2.2 Add `submissions` table

```typescript
export const submissions = sqliteTable("submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.telegramId),
  templateId: integer("template_id").notNull().references(() => cardTemplates.id),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id").notNull(),
  status: text("status").$type<SubmissionStatus>().notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
```

### 2.3 Update `cards` table

```typescript
export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submissionId: integer("submission_id").notNull().references(() => submissions.id),
  word: text("word").notNull(),
  sentence: text("sentence").notNull(),
  status: text("status").$type<CardStatus>().notNull().default("pending"),
  llmResponseJson: text("llm_response_json"),
  audioR2Key: text("audio_r2_key"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
```

Changes from current schema: `deckId` → `submissionId`, added `llmResponseJson` + `errorMessage` + `updatedAt`, removed
`ankiNoteId`.

### 2.4 Inferred types

```typescript
export type SelectSubmission = typeof submissions.$inferSelect;
export type InsertSubmission = typeof submissions.$inferInsert;
// SelectDeck / InsertDeck removed
```

These Drizzle-inferred types are used only in the adapter layer (repository implementations). Port interfaces use
domain-level `NewCard` / `NewSubmission` types instead.

### 2.5 Migration

Run `deno task db:generate`. Pre-production: clean replacement, not incremental ALTER.

## 3. Queue Contracts

### Before

```typescript
GenerateDeckMessage { type: "generate_deck", deckId: number }
```

### After

```typescript
export const GenerateCardMessage = z.object({
  type: z.literal("generate_card"),
  cardId: z.number().int().min(1),
});

export const QueueMessage = z.discriminatedUnion("type", [
  GenerateCardMessage,
]);
```

Per-card granularity for failure isolation and parallelism.

### 3.1 QueuePort (`workers/shared/ports/queue.ts`)

Per hexagonal architecture, the service layer should not call `env.EVENTS.send()` directly. Add a `QueuePort` interface:

```typescript
export interface QueuePort {
  send(message: QueueMessage): ResultAsync<void, QueueError>;
}
```

The API worker's adapter wraps `env.EVENTS.send()`. The processor does not need a queue producer binding — it only
consumes messages.

## 4. Env Interface

The API and processor workers have different binding requirements. Define per-worker Env types that extend a shared
base:

```typescript
// workers/shared/env.ts — shared base
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface BaseEnv {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly TELEGRAM_BOT_TOKEN: string;
}

// workers/api/env.ts (or inline in api worker)
export interface ApiEnv extends BaseEnv {
  readonly EVENTS: Queue; // queue producer (Queue from @cloudflare/workers-types)
}

// workers/processor/env.ts (or inline in processor worker)
export interface ProcessorEnv extends BaseEnv {
  readonly AI: Ai; // Cloudflare Workers AI binding (exported from @cloudflare/workers-types)
  readonly TTS_API_URL: string;
  readonly TTS_API_KEY: string;
}
```

`Ai` is exported from `@cloudflare/workers-types@^4.20260214.0` (verified). The processor's `wrangler.jsonc` needs an
`ai` binding added:

```jsonc
// workers/processor/wrangler.jsonc — add:
"ai": { "binding": "AI" }
```

### 4.1 .dev.vars updates

- `workers/processor/.dev.vars.example` — add `TTS_API_URL=` and `TTS_API_KEY=`

## 5. Port Interfaces

All in `workers/shared/ports/`, all return `neverthrow` `ResultAsync`. All interfaces are `export interface`.

### 5.1 `llm.ts` — LlmPort

```typescript
export interface LlmPort {
  generateStructured<T>(prompt: string, jsonSchema: string): ResultAsync<T, LlmError>;
}
```

Generic `<T>` — callers specify the expected return type. The adapter performs Zod validation against `jsonSchema`
internally and returns the validated, typed result. If validation fails, it returns `LlmError`.

### 5.2 `tts.ts` — TtsPort

```typescript
export interface TtsPort {
  synthesize(text: string, language: Language): ResultAsync<Uint8Array, TtsError>;
}
```

The `language` parameter comes from `User.languageCode` via `Submission → User` join. This join is the service layer's
responsibility (done once per submission, not per card).

### 5.3 `chat_notification.ts` — ChatNotificationPort

```typescript
export interface ChatNotificationPort {
  editMessage(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError>;
  sendFile(chatId: string, file: Uint8Array, filename: string, caption?: string): ResultAsync<void, NotificationError>;
}
```

Optional `caption` parameter on `sendFile` for UX (e.g., "Here is your deck with 10 cards").

### 5.4 `card_repository.ts` — CardRepositoryPort

```typescript
export interface CardRepositoryPort {
  findById(id: number): ResultAsync<Card | null, RepositoryError>;
  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError>;
  create(card: NewCard): ResultAsync<Card, RepositoryError>;
  updateStatus(id: number, status: CardStatus, fields?: CardUpdateFields): ResultAsync<Card, RepositoryError>;
}
```

Uses domain-level `NewCard` and `CardUpdateFields` — no Drizzle type leakage.

### 5.5 `submission_repository.ts` — SubmissionRepositoryPort

```typescript
export interface SubmissionRepositoryPort {
  findById(id: number): ResultAsync<Submission | null, RepositoryError>;
  create(submission: NewSubmission): ResultAsync<Submission, RepositoryError>;
  updateStatus(
    id: number,
    status: SubmissionStatus,
    fields?: SubmissionUpdateFields,
  ): ResultAsync<Submission, RepositoryError>;
}
```

### 5.6 `user_repository.ts` — UserRepositoryPort

```typescript
export interface UserRepositoryPort {
  upsert(user: NewUser): ResultAsync<User, RepositoryError>;
}
```

`NewUser` = `Omit<User, "createdAt">`, defined in `workers/shared/domain/user.ts`.

### 5.7 `queue.ts` — QueuePort

```typescript
export interface QueuePort {
  send(message: QueueMessage): ResultAsync<void, QueueError>;
}
```

### 5.8 Note on CardTemplateRepositoryPort

Intentionally deferred to M2/M3. M1 defines the port layer foundation; card template lookup is needed when the service
layer processes submissions (M3 scope). Will be added as a port then.

## 6. `mod.ts` Exports

Updated to export all new types, removing all Deck-related exports:

- Domain: `Submission`, `SubmissionStatus`, `Card`, `CardStatus`, `User`, `CardTemplate`, `Language`, error types,
  `NewCard`, `NewSubmission`, `NewUser`, `CardUpdateFields`, `SubmissionUpdateFields`
- Schema: `submissions`, `cards`, `cardTemplates`, `users` + inferred types (adapter-only)
- Ports: all 7 port interfaces (including `QueuePort`)
- Queue: `GenerateCardMessage`, `QueueMessage`
- Env: `BaseEnv` (per-worker envs defined in their own workers)

## 7. Implementation Order

Incremental migration, one commit per issue, TDD throughout:

1. **Issue #1** — CardStatus (update enum + tests)
2. **Issue #2** — Submission entity + Card restructure (new files, delete Deck files, update mod.ts)
3. **Issue #3** — D1 schema (Drizzle tables + migration)
4. **Issue #4** — Queue contracts (rename + add QueuePort + update tests)
5. **Issue #5** — Env interface (split into BaseEnv/ApiEnv/ProcessorEnv, add AI + TTS bindings, update wrangler.jsonc)
6. **Issue #6** — Port interfaces (6 service ports + error types; QueuePort added in Issue #4)

Each step: write failing test → implement → verify green → `deno task check` → commit.
