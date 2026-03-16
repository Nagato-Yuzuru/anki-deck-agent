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

## 1. Domain Types

### 1.1 CardStatus (`workers/shared/domain/card_status.ts`)

```
PENDING → GENERATING → READY → EXPORTED | FAILED
```

5 states. Removes `SYNCED`, adds `GENERATING`, `EXPORTED`, `FAILED`.

### 1.2 SubmissionStatus (`workers/shared/domain/submission_status.ts` — new)

```
PENDING → PROCESSING → DONE | FAILED
```

4 states. Same `as const` pattern as CardStatus.

### 1.3 Submission (`workers/shared/domain/submission.ts` — new)

```typescript
type Submission = {
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

### 1.4 Card (`workers/shared/domain/card.ts` — updated)

```typescript
type Card = {
  readonly id: number;
  readonly submissionId: number;
  readonly word: string;
  readonly sentence: string;
  readonly status: CardStatus;
  readonly llmResponseJson: string | null;
  readonly audioR2Key: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
};
```

### 1.5 Error Types (`workers/shared/domain/errors.ts` — new)

```typescript
type LlmError = { readonly kind: "llm"; readonly message: string };
type TtsError = { readonly kind: "tts"; readonly message: string };
type NotificationError = { readonly kind: "notification"; readonly message: string };
type RepositoryError = { readonly kind: "repository"; readonly message: string };
```

### 1.6 Deletions

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
});
```

Changes: `deckId` → `submissionId`, added `llmResponseJson` + `errorMessage`, removed `ankiNoteId`.

### 2.4 Inferred types

```typescript
export type SelectSubmission = typeof submissions.$inferSelect;
export type InsertSubmission = typeof submissions.$inferInsert;
// SelectDeck / InsertDeck removed
```

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

## 4. Env Interface

```typescript
interface Env {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly EVENTS: Queue;
  readonly TELEGRAM_BOT_TOKEN: string;
  readonly AI: Ai; // Cloudflare Workers AI binding
  readonly TTS_API_URL: string;
  readonly TTS_API_KEY: string;
}
```

`AI` is a native Cloudflare binding (configured in `wrangler.jsonc`). TTS is an external service requiring URL + KEY.

## 5. Port Interfaces

All in `workers/shared/ports/`, all return `neverthrow` `ResultAsync`.

### 5.1 `llm.ts` — LlmPort

```typescript
interface LlmPort {
  generateStructured(prompt: string, jsonSchema: string): ResultAsync<unknown, LlmError>;
}
```

### 5.2 `tts.ts` — TtsPort

```typescript
interface TtsPort {
  synthesize(text: string, language: Language): ResultAsync<Uint8Array, TtsError>;
}
```

### 5.3 `chat_notification.ts` — ChatNotificationPort

```typescript
interface ChatNotificationPort {
  editMessage(chatId: string, messageId: string, text: string): ResultAsync<void, NotificationError>;
  sendFile(chatId: string, file: Uint8Array, filename: string): ResultAsync<void, NotificationError>;
}
```

### 5.4 `card_repository.ts` — CardRepositoryPort

```typescript
interface CardRepositoryPort {
  findById(id: number): ResultAsync<Card | null, RepositoryError>;
  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError>;
  create(card: InsertCard): ResultAsync<Card, RepositoryError>;
  updateStatus(id: number, status: CardStatus, fields?: Partial<Card>): ResultAsync<Card, RepositoryError>;
}
```

### 5.5 `submission_repository.ts` — SubmissionRepositoryPort

```typescript
interface SubmissionRepositoryPort {
  findById(id: number): ResultAsync<Submission | null, RepositoryError>;
  create(submission: InsertSubmission): ResultAsync<Submission, RepositoryError>;
  updateStatus(
    id: number,
    status: SubmissionStatus,
    fields?: Partial<Submission>,
  ): ResultAsync<Submission, RepositoryError>;
}
```

### 5.6 `user_repository.ts` — UserRepositoryPort

```typescript
interface UserRepositoryPort {
  upsert(user: InsertUser): ResultAsync<User, RepositoryError>;
}
```

## 6. `mod.ts` Exports

Updated to export all new types, removing all Deck-related exports:

- Domain: `Submission`, `SubmissionStatus`, `Card`, `CardStatus`, `User`, `CardTemplate`, `Language`, error types
- Schema: `submissions`, `cards`, `cardTemplates`, `users` + inferred types
- Ports: all 6 port interfaces
- Queue: `GenerateCardMessage`, `QueueMessage`
- Env: `Env`

## 7. Implementation Order

Incremental migration, one commit per issue, TDD throughout:

1. **Issue #1** — CardStatus (update enum + tests)
2. **Issue #2** — Submission entity + Card restructure (new files, delete Deck files, update mod.ts)
3. **Issue #3** — D1 schema (Drizzle tables + migration)
4. **Issue #4** — Queue contracts (rename + update tests)
5. **Issue #5** — Env interface (add AI + TTS bindings)
6. **Issue #6** — Port interfaces (all 6 ports + error types)

Each step: write failing test → implement → verify green → `deno task check` → commit.
