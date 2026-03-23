# M5: Export & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Anki export pipeline (/export → TSV) and polish the system with error handling, plain text support, and seed data.

**Architecture:** Extends the existing hexagonal architecture. New pure function `exportCards` in shared layer generates TSV from domain types. Export handler orchestrates repository queries → TSV generation → Telegram file send → status update. Error classification in processor enables smart retry/ack decisions.

**Tech Stack:** Deno, Hono, grammY, Drizzle ORM (D1), neverthrow, Cloudflare Workers/Queues

**Spec:** `docs/superpowers/specs/2026-03-24-m5-export-polish-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `workers/shared/domain/ready_card.ts` | `ReadyCard` type (Card + templateId) |
| `workers/shared/services/export_cards.ts` | Pure function: cards + template → TSV |
| `workers/shared/services/export_cards_test.ts` | Tests for TSV generation |
| `workers/shared/db/seed.sql` | SQL seed for default CardTemplate (wrangler d1 execute) |
| `workers/shared/db/seed.ts` | Default template constant for programmatic use |
| `workers/api/handlers/export_command.ts` | /export handler orchestration |
| `workers/api/handlers/export_command_test.ts` | Tests for export handler |
| `workers/api/adapters/telegram_notification.ts` | ChatNotificationPort impl for api worker |

### Modified files
| File | Changes |
|------|---------|
| `workers/shared/domain/errors.ts` | Add `ExportError`, `ErrorClassification`, `classifyError()` |
| `workers/shared/domain/user.ts` | Add `activeTemplateId` field |
| `workers/shared/domain/card_template.ts` | Add `NewCardTemplate` type |
| `workers/shared/domain/mod.ts` | Re-export new types |
| `workers/shared/mod.ts` | Re-export new types |
| `workers/shared/db/schema.ts` | Add `active_template_id` column to users |
| `workers/shared/ports/card_repository.ts` | Add `findReadyByUserId()`, `markExported()` |
| `workers/shared/ports/user_repository.ts` | Add `updateActiveTemplate()` |
| `workers/shared/ports/template_repository.ts` | Add `create()`, `findDefault()` |
| `workers/shared/adapters/d1_card_repository.ts` | Implement new methods |
| `workers/shared/adapters/d1_template_repository.ts` | Implement new methods |
| `workers/shared/adapters/d1_user_repository.ts` | Add `activeTemplateId` to domain mapping, add `updateActiveTemplate()` |
| `workers/api/adapters/telegram_webhook.ts` | Register /export, plain text handler, template fallback |
| `workers/api/services/submit_word.ts` | Use `user.activeTemplateId` with fallback |
| `workers/api/test_helpers.ts` | Update mocks for new port methods |
| `workers/processor/index.ts` | Error classification + retry/ack logic + idempotency |
| `workers/processor/adapters/telegram_notification.ts` | Implement `sendFile` |
| `workers/processor/services/generate_card.ts` | Add idempotency guard |
| `deno.jsonc` | Add `db:seed` task |

---

## Task 1: Domain & Error Types

**Files:**
- Modify: `workers/shared/domain/errors.ts`
- Modify: `workers/shared/domain/user.ts`
- Modify: `workers/shared/domain/card_template.ts`
- Create: `workers/shared/domain/ready_card.ts`
- Modify: `workers/shared/domain/mod.ts`
- Modify: `workers/shared/mod.ts`

- [ ] **Step 1: Add ExportError, ErrorClassification, classifyError to errors.ts**

```typescript
// Append to workers/shared/domain/errors.ts

export type ExportError = { readonly kind: "export"; readonly message: string };

export type ErrorClassification = "transient" | "permanent";

export type AppError = LlmError | TtsError | NotificationError | RepositoryError | QueueError | ExportError;

export function classifyError(error: { kind: string; message: string }): ErrorClassification {
  const msg = error.message.toLowerCase();
  switch (error.kind) {
    case "llm":
      return msg.includes("schema") || msg.includes("parse") ? "permanent" : "transient";
    case "repository":
      return msg.includes("not found") ? "permanent" : "transient";
    case "export":
      return "permanent";
    case "notification":
    case "queue":
      return "transient";
    default:
      return "transient";
  }
}
```

- [ ] **Step 2: Add activeTemplateId to User type**

In `workers/shared/domain/user.ts`, add `activeTemplateId`:

```typescript
import type { Language } from "./language.ts";

export type User = {
  readonly telegramId: number;
  readonly firstName: string;
  readonly languageCode: Language | null;
  readonly activeTemplateId: number | null;
  readonly createdAt: string;
};

export type NewUser = Omit<User, "createdAt" | "activeTemplateId">;
```

- [ ] **Step 3: Add NewCardTemplate type**

In `workers/shared/domain/card_template.ts`:

```typescript
export type CardTemplate = {
  readonly id: number;
  readonly name: string;
  readonly promptTemplate: string;
  readonly responseJsonSchema: string;
  readonly ankiNoteType: string;
  readonly ankiFieldsMapping: string;
  readonly isActive: boolean;
  readonly createdAt: string;
};

export type NewCardTemplate = Omit<CardTemplate, "id" | "createdAt">;
```

- [ ] **Step 4: Create ReadyCard type**

Create `workers/shared/domain/ready_card.ts`:

```typescript
import type { Card } from "./card.ts";

export type ReadyCard = Card & { readonly templateId: number };
```

- [ ] **Step 5: Update mod.ts re-exports**

In `workers/shared/domain/mod.ts`, add:
```typescript
export type { ReadyCard } from "./ready_card.ts";
export type { NewCardTemplate } from "./card_template.ts";
export type { ExportError } from "./errors.ts";
export { classifyError } from "./errors.ts";
export type { ErrorClassification } from "./errors.ts";
```

In `workers/shared/mod.ts`, add:
```typescript
export type { ReadyCard } from "./domain/ready_card.ts";
export type { NewCardTemplate } from "./domain/card_template.ts";
export type { ExportError } from "./domain/errors.ts";
export { classifyError } from "./domain/errors.ts";
export type { ErrorClassification } from "./domain/errors.ts";
```

- [ ] **Step 6: Run checks**

Run: `deno task check`
Expected: PASS (no type errors, lint clean)

- [ ] **Step 7: Commit**

```bash
git add workers/shared/domain/ workers/shared/mod.ts
git commit -m "feat(shared): add ExportError, ReadyCard, NewCardTemplate, classifyError, User.activeTemplateId"
```

---

## Task 2: Schema Migration & Port Extensions

**Files:**
- Modify: `workers/shared/db/schema.ts`
- Modify: `workers/shared/ports/card_repository.ts`
- Modify: `workers/shared/ports/user_repository.ts`
- Modify: `workers/shared/ports/template_repository.ts`

- [ ] **Step 1: Add active_template_id to users schema**

In `workers/shared/db/schema.ts`, modify `users`:

```typescript
export const users = sqliteTable("users", {
  telegramId: integer("telegram_id").primaryKey(),
  firstName: text("first_name").notNull(),
  languageCode: text("language_code").$type<Language>(),
  activeTemplateId: integer("active_template_id").references(() => cardTemplates.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});
```

- [ ] **Step 2: Extend CardRepositoryPort**

In `workers/shared/ports/card_repository.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { Card, CardStatus, CardUpdateFields, NewCard, ReadyCard } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface CardRepositoryPort {
  findById(id: number): ResultAsync<Card | null, RepositoryError>;
  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError>;
  findActiveByUserIdAndWord(userId: number, word: string): ResultAsync<Card | null, RepositoryError>;
  create(card: NewCard): ResultAsync<Card, RepositoryError>;
  updateStatus(id: number, status: CardStatus, fields?: CardUpdateFields): ResultAsync<Card, RepositoryError>;
  findReadyByUserId(userId: number): ResultAsync<readonly ReadyCard[], RepositoryError>;
  markExported(ids: readonly number[]): ResultAsync<void, RepositoryError>;
}
```

- [ ] **Step 3: Extend UserRepositoryPort**

In `workers/shared/ports/user_repository.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { NewUser, User } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface UserRepositoryPort {
  upsert(user: NewUser): ResultAsync<User, RepositoryError>;
  findByTelegramId(telegramId: number): ResultAsync<User | null, RepositoryError>;
  updateActiveTemplate(telegramId: number, templateId: number | null): ResultAsync<User, RepositoryError>;
}
```

- [ ] **Step 4: Extend TemplateRepositoryPort**

In `workers/shared/ports/template_repository.ts`:

```typescript
import type { ResultAsync } from "neverthrow";
import type { CardTemplate, NewCardTemplate } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface TemplateRepositoryPort {
  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError>;
  findDefault(): ResultAsync<CardTemplate | null, RepositoryError>;
  create(template: NewCardTemplate): ResultAsync<CardTemplate, RepositoryError>;
}
```

- [ ] **Step 5: Generate migration**

Run: `deno task db:generate`
Expected: New migration file created in `workers/shared/db/migrations/`

- [ ] **Step 6: Run checks**

Run: `deno task check`
Expected: Expect type errors in adapter implementations (they don't implement the new methods yet). That's OK — Task 3 fixes them.

- [ ] **Step 7: Commit**

```bash
git add workers/shared/db/ workers/shared/ports/
git commit -m "feat(shared): extend ports with findReadyByUserId, markExported, findDefault, updateActiveTemplate"
```

---

## Task 3: Adapter Implementations

**Files:**
- Modify: `workers/shared/adapters/d1_card_repository.ts`
- Modify: `workers/shared/adapters/d1_template_repository.ts`
- Modify: `workers/shared/adapters/d1_user_repository.ts`
- Modify: `workers/api/test_helpers.ts`

- [ ] **Step 1: Implement findReadyByUserId and markExported in D1CardRepository**

Add to `workers/shared/adapters/d1_card_repository.ts`:

```typescript
findReadyByUserId(userId: number): ResultAsync<readonly ReadyCard[], RepositoryError> {
  return ResultAsync.fromPromise(
    this.db
      .select({ card: cards, templateId: submissions.templateId })
      .from(cards)
      .innerJoin(submissions, eq(cards.submissionId, submissions.id))
      .where(
        and(
          eq(submissions.userId, userId),
          eq(cards.status, CARD_STATUS.READY),
        ),
      )
      .then((rows) => rows.map((r) => ({ ...this.toDomain(r.card), templateId: r.templateId }))),
    (err): RepositoryError => ({ kind: "repository", message: String(err) }),
  );
}

markExported(ids: readonly number[]): ResultAsync<void, RepositoryError> {
  if (ids.length === 0) return okAsync(undefined);
  return ResultAsync.fromPromise(
    this.db
      .update(cards)
      .set({ status: CARD_STATUS.EXPORTED, updatedAt: new Date().toISOString() })
      .where(and(inArray(cards.id, [...ids]), eq(cards.status, CARD_STATUS.READY)))
      .then(() => undefined),
    (err): RepositoryError => ({ kind: "repository", message: String(err) }),
  );
}
```

Add imports: `import { and, eq, inArray, notInArray } from "drizzle-orm";` and `import { okAsync } from "neverthrow";` and `import type { ReadyCard } from "../domain/mod.ts";`

- [ ] **Step 2: Implement findDefault and create in D1TemplateRepository**

Add to `workers/shared/adapters/d1_template_repository.ts`:

```typescript
findDefault(): ResultAsync<CardTemplate | null, RepositoryError> {
  return ResultAsync.fromPromise(
    this.db
      .select()
      .from(cardTemplates)
      .where(eq(cardTemplates.isActive, 1))
      .limit(1)
      .then((rows) => (rows[0] ? D1TemplateRepository.toDomain(rows[0]) : null)),
    (err): RepositoryError => ({ kind: "repository", message: String(err) }),
  );
}

create(template: NewCardTemplate): ResultAsync<CardTemplate, RepositoryError> {
  return ResultAsync.fromPromise(
    this.db
      .insert(cardTemplates)
      .values({
        name: template.name,
        promptTemplate: template.promptTemplate,
        responseJsonSchema: template.responseJsonSchema,
        ankiNoteType: template.ankiNoteType,
        ankiFieldsMapping: template.ankiFieldsMapping,
        isActive: template.isActive ? 1 : 0,
      })
      .returning()
      .then((rows) => D1TemplateRepository.toDomain(rows[0]!)),
    (err): RepositoryError => ({ kind: "repository", message: String(err) }),
  );
}
```

Add import: `import type { CardTemplate, NewCardTemplate } from "../domain/mod.ts";`

- [ ] **Step 3: Update D1UserRepository for activeTemplateId**

In `workers/shared/adapters/d1_user_repository.ts`:

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
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findByTelegramId(telegramId: number): ResultAsync<User | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateActiveTemplate(telegramId: number, templateId: number | null): ResultAsync<User, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(users)
        .set({ activeTemplateId: templateId })
        .where(eq(users.telegramId, telegramId))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      telegramId: row.telegramId,
      firstName: row.firstName,
      languageCode: row.languageCode,
      activeTemplateId: row.activeTemplateId ?? null,
      createdAt: row.createdAt,
    };
  }
}
```

- [ ] **Step 4: Update mock helpers**

In `workers/api/test_helpers.ts` — no changes needed (mocks are in test files).

Update `workers/api/services/submit_word_test.ts` mock factories to include new methods:

```typescript
function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(null),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: (_card: NewCard) =>
      okAsync({
        id: 1,
        submissionId: 1,
        word: "apple",
        sentence: "I ate an apple",
        status: "pending" as const,
        llmResponseJson: null,
        audioR2Key: null,
        errorMessage: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    updateStatus: () => okAsync({} as Card),
    findReadyByUserId: () => okAsync([]),
    markExported: () => okAsync(undefined),
    ...overrides,
  };
}

function mockUserRepo(overrides?: Partial<UserRepositoryPort>): UserRepositoryPort {
  return {
    upsert: () =>
      okAsync({ telegramId: 100, firstName: "Test", languageCode: null, activeTemplateId: null, createdAt: "2026-01-01T00:00:00Z" }),
    findByTelegramId: () =>
      okAsync({ telegramId: 100, firstName: "Test", languageCode: null, activeTemplateId: null, createdAt: "2026-01-01T00:00:00Z" }),
    updateActiveTemplate: () =>
      okAsync({ telegramId: 100, firstName: "Test", languageCode: null, activeTemplateId: null, createdAt: "2026-01-01T00:00:00Z" }),
    ...overrides,
  };
}
```

Also update `workers/processor/services/generate_card_test.ts` mock factories similarly — add `findReadyByUserId` and `markExported` to `mockCardRepo`.

- [ ] **Step 5: Run checks and tests**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/shared/adapters/ workers/api/services/submit_word_test.ts workers/processor/services/generate_card_test.ts
git commit -m "feat(shared): implement adapter extensions for findReadyByUserId, markExported, findDefault, updateActiveTemplate"
```

---

## Task 4: exportCards Pure Function (TDD)

**Files:**
- Create: `workers/shared/services/export_cards.ts`
- Create: `workers/shared/services/export_cards_test.ts`

- [ ] **Step 1: Write failing tests**

Create `workers/shared/services/export_cards_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Card, CardTemplate } from "../domain/mod.ts";
import { exportCards } from "./export_cards.ts";

const template: CardTemplate = {
  id: 1,
  name: "Vocabulary",
  promptTemplate: "",
  responseJsonSchema: "",
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({
    Front: "word",
    Meaning: "meaning",
    Notes: "notes",
  }),
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function makeCard(id: number, llmResponseJson: string | null): Card {
  return {
    id,
    submissionId: 1,
    word: "test",
    sentence: "test sentence",
    status: "ready",
    llmResponseJson,
    audioR2Key: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("exportCards", () => {
  it("should generate TSV from cards with valid JSON", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, JSON.stringify({ word: "book", meaning: "a text", notes: "noun" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [1, 2]);
        const lines = val.tsv.split("\n");
        assertEquals(lines[0], "apple\ta fruit\tcommon");
        assertEquals(lines[1], "book\ta text\tnoun");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should skip cards with null llmResponseJson", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, null),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [1]);
        assertEquals(val.tsv, "apple\ta fruit\tcommon");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should skip cards with unparseable JSON", () => {
    const cards = [
      makeCard(1, "not json"),
      makeCard(2, JSON.stringify({ word: "book", meaning: "a text", notes: "" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [2]);
        assertEquals(val.tsv, "book\ta text\t");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should sanitize tabs and newlines in field values", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "test\tword", meaning: "line1\nline2", notes: "ok\rok" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.tsv, "test word\tline1 line2\tok ok");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should return ExportError when all cards have invalid JSON", () => {
    const cards = [makeCard(1, null), makeCard(2, "bad json")];

    const result = exportCards({ cards, template });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "export");
      },
    );
  });

  it("should handle missing fields in JSON by using empty string", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.tsv, "apple\t\t");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env workers/shared/services/export_cards_test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement exportCards**

Create `workers/shared/services/export_cards.ts`:

```typescript
import { err, ok, type Result } from "neverthrow";
import type { Card, CardTemplate } from "../domain/mod.ts";
import type { ExportError } from "../domain/errors.ts";

export type ExportCardsInput = {
  readonly cards: readonly Card[];
  readonly template: CardTemplate;
};

export type ExportCardsResult = {
  readonly tsv: string;
  readonly cardIds: readonly number[];
};

function sanitize(value: string): string {
  return value.replace(/[\t\r\n]/g, " ");
}

export function exportCards(input: ExportCardsInput): Result<ExportCardsResult, ExportError> {
  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(input.template.ankiFieldsMapping) as Record<string, string>;
  } catch {
    return err({ kind: "export", message: `Invalid ankiFieldsMapping JSON in template "${input.template.name}"` });
  }
  const fieldKeys = Object.values(mapping);

  const rows: string[] = [];
  const cardIds: number[] = [];

  for (const card of input.cards) {
    if (card.llmResponseJson === null) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(card.llmResponseJson) as Record<string, unknown>;
    } catch {
      continue;
    }

    const fields = fieldKeys.map((key) => sanitize(String(parsed[key] ?? "")));
    rows.push(fields.join("\t"));
    cardIds.push(card.id);
  }

  if (rows.length === 0) {
    return err({ kind: "export", message: "No valid cards to export" });
  }

  return ok({ tsv: rows.join("\n"), cardIds });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env workers/shared/services/export_cards_test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full checks**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/shared/services/
git commit -m "feat(shared): add exportCards pure function for TSV generation"
```

---

## Task 5: Seed Default Template

**Files:**
- Create: `workers/shared/db/seed.ts`
- Modify: `deno.jsonc`

- [ ] **Step 1: Create seed SQL file**

Create `workers/shared/db/seed.sql` with the default template data. This is executed via `wrangler d1 execute` which has direct D1 access:

```sql
INSERT OR IGNORE INTO card_templates (name, prompt_template, response_json_schema, anki_note_type, anki_fields_mapping, is_active)
VALUES (
  'Vocabulary',
  'You are a language learning assistant. The user is learning vocabulary.

Word: {word}
Context sentence: {sentence}

Based on the word and context, generate a flashcard with:
- The word itself
- Pronunciation/reading in the target language''s phonetic system (if applicable)
- Meaning explained in the context language
- An example sentence in the source language
- The same example translated to the target language
- Any helpful notes about usage, etymology, or common mistakes

Respond in JSON matching the provided schema.',
  '{"type":"object","properties":{"word":{"type":"string"},"reading":{"type":"string"},"meaning":{"type":"string"},"example_source":{"type":"string"},"example_target":{"type":"string"},"notes":{"type":"string"}},"required":["word","reading","meaning","example_source","example_target","notes"]}',
  'Vocabulary',
  '{"Front":"word","Reading":"reading","Meaning":"meaning","ExampleSource":"example_source","ExampleTarget":"example_target","Notes":"notes"}',
  1
);
```

- [ ] **Step 2: Also create seed.ts for programmatic use**

Create `workers/shared/db/seed.ts` that exports the template data as a constant for use in tests and future admin tools:

```typescript
import type { NewCardTemplate } from "../domain/mod.ts";

export const DEFAULT_TEMPLATE: NewCardTemplate = {
  name: "Vocabulary",
  promptTemplate: `You are a language learning assistant. The user is learning vocabulary.

Word: {word}
Context sentence: {sentence}

Based on the word and context, generate a flashcard with:
- The word itself
- Pronunciation/reading in the target language's phonetic system (if applicable)
- Meaning explained in the context language
- An example sentence in the source language
- The same example translated to the target language
- Any helpful notes about usage, etymology, or common mistakes

Respond in JSON matching the provided schema.`,
  responseJsonSchema: JSON.stringify({
    type: "object",
    properties: {
      word: { type: "string" },
      reading: { type: "string" },
      meaning: { type: "string" },
      example_source: { type: "string" },
      example_target: { type: "string" },
      notes: { type: "string" },
    },
    required: ["word", "reading", "meaning", "example_source", "example_target", "notes"],
  }),
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({
    Front: "word",
    Reading: "reading",
    Meaning: "meaning",
    ExampleSource: "example_source",
    ExampleTarget: "example_target",
    Notes: "notes",
  }),
  isActive: true,
};
```

- [ ] **Step 3: Add db:seed task to deno.jsonc**

Add to `tasks` in `deno.jsonc`:

```json
"db:seed": "wrangler d1 execute anki-deck-db --local --file workers/shared/db/seed.sql"
```

- [ ] **Step 3: Run checks**

Run: `deno task check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add workers/shared/db/seed.ts deno.jsonc
git commit -m "feat(shared): add seed script for default Vocabulary template"
```

---

## Task 6: Implement sendFile in Telegram Notification Adapter

**Files:**
- Modify: `workers/processor/adapters/telegram_notification.ts`

- [ ] **Step 1: Replace sendFile stub with implementation**

In `workers/processor/adapters/telegram_notification.ts`, replace the `sendFile` method:

```typescript
sendFile(
  chatId: string,
  file: Uint8Array,
  filename: string,
  caption?: string,
): ResultAsync<void, NotificationError> {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", new Blob([file]), filename);
  if (caption) {
    formData.append("caption", caption);
  }

  return ResultAsync.fromPromise(
    fetchFn(`${baseUrl}/sendDocument`, {
      method: "POST",
      body: formData,
    }),
    (err): NotificationError => ({
      kind: "notification",
      message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    }),
  ).andThen((response) => {
    if (response.ok) {
      console.log({ event: "file_sent", chatId, filename });
      return okAsync(undefined);
    }

    return ResultAsync.fromPromise(
      response.text(),
      (err): NotificationError => ({
        kind: "notification",
        message: `HTTP ${response.status} (failed to read body: ${err instanceof Error ? err.message : String(err)})`,
      }),
    ).andThen((bodyText) => {
      const truncatedBody = bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText;
      return errAsync<void, NotificationError>({
        kind: "notification",
        message: `HTTP ${response.status}: ${truncatedBody}`,
      });
    });
  });
},
```

Add `okAsync` to the neverthrow import.

- [ ] **Step 2: Run checks**

Run: `deno task check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add workers/processor/adapters/telegram_notification.ts
git commit -m "feat(processor): implement sendFile in Telegram notification adapter"
```

---

## Task 7: API-side Telegram Notification Adapter

**Files:**
- Create: `workers/api/adapters/telegram_notification.ts`

- [ ] **Step 1: Create api-side adapter**

Create `workers/api/adapters/telegram_notification.ts` that re-exports the processor's factory function. Both workers use the same Telegram Bot API — the adapter is identical:

```typescript
// Re-export the shared Telegram notification adapter factory.
// API and processor workers both use the same Telegram Bot API.
export { createTelegramNotification } from "../../processor/adapters/telegram_notification.ts";
export type { TelegramNotificationConfig } from "../../processor/adapters/telegram_notification.ts";
```

Wait — this violates the import direction rule: `api/` must not import `processor/`. Instead, move the factory to `shared/adapters/` and have both workers import from there.

**Revised approach:** Move `telegram_notification.ts` from `workers/processor/adapters/` to `workers/shared/adapters/` and update imports.

- [ ] **Step 1 (revised): Move telegram_notification.ts to shared/adapters/**

Move `workers/processor/adapters/telegram_notification.ts` → `workers/shared/adapters/telegram_notification.ts`

Update `workers/processor/index.ts` import:
```typescript
import { createTelegramNotification } from "../shared/adapters/telegram_notification.ts";
```

- [ ] **Step 2: Run checks and tests**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add workers/shared/adapters/telegram_notification.ts workers/processor/
git commit -m "refactor: move TelegramNotification adapter to shared layer for reuse by api worker"
```

---

## Task 8: /export Handler (TDD)

**Files:**
- Create: `workers/api/handlers/export_command.ts`
- Create: `workers/api/handlers/export_command_test.ts`

- [ ] **Step 1: Write failing tests**

Create `workers/api/handlers/export_command_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { okAsync, errAsync } from "neverthrow";
import type {
  Card,
  CardRepositoryPort,
  ChatNotificationPort,
  NewCard,
  ReadyCard,
  TemplateRepositoryPort,
  CardTemplate,
} from "../../shared/mod.ts";
import type { RepositoryError, NotificationError } from "../../shared/domain/errors.ts";
import { handleExport, type ExportDeps } from "./export_command.ts";

const template: CardTemplate = {
  id: 1,
  name: "Vocabulary",
  promptTemplate: "",
  responseJsonSchema: "",
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({ Front: "word", Meaning: "meaning" }),
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function makeReadyCard(id: number, word: string, json: string): ReadyCard {
  return {
    id,
    submissionId: 1,
    word,
    sentence: "test",
    status: "ready",
    llmResponseJson: json,
    audioR2Key: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: 1,
  };
}

function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(null),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: () => okAsync({} as Card),
    updateStatus: () => okAsync({} as Card),
    findReadyByUserId: () => okAsync([]),
    markExported: () => okAsync(undefined),
    ...overrides,
  };
}

function mockTemplateRepo(overrides?: Partial<TemplateRepositoryPort>): TemplateRepositoryPort {
  return {
    findById: () => okAsync(template),
    findDefault: () => okAsync(template),
    create: () => okAsync(template),
    ...overrides,
  };
}

function mockNotification(overrides?: Partial<ChatNotificationPort>): ChatNotificationPort {
  return {
    editMessage: () => okAsync(undefined),
    sendFile: () => okAsync(undefined),
    ...overrides,
  };
}

describe("handleExport", () => {
  it("should return no-cards message when no ready cards exist", async () => {
    const deps: ExportDeps = {
      cardRepo: mockCardRepo(),
      templateRepo: mockTemplateRepo(),
      notification: mockNotification(),
    };

    const result = await handleExport({ userId: 1, chatId: "123" }, deps);

    result.match(
      (val) => assertEquals(val.exported, 0),
      (err) => { throw new Error(`Expected ok, got: ${err.message}`); },
    );
  });

  it("should export cards and send file", async () => {
    let sentFile: { chatId: string; filename: string } | undefined;
    let markedIds: readonly number[] | undefined;

    const readyCards: ReadyCard[] = [
      makeReadyCard(1, "apple", JSON.stringify({ word: "apple", meaning: "a fruit" })),
      makeReadyCard(2, "book", JSON.stringify({ word: "book", meaning: "a text" })),
    ];

    const deps: ExportDeps = {
      cardRepo: mockCardRepo({
        findReadyByUserId: () => okAsync(readyCards),
        markExported: (ids) => { markedIds = ids; return okAsync(undefined); },
      }),
      templateRepo: mockTemplateRepo(),
      notification: mockNotification({
        sendFile: (chatId, _file, filename) => {
          sentFile = { chatId, filename };
          return okAsync(undefined);
        },
      }),
    };

    const result = await handleExport({ userId: 1, chatId: "123" }, deps);

    result.match(
      (val) => {
        assertEquals(val.exported, 2);
        assertEquals(sentFile?.chatId, "123");
        assertEquals(sentFile?.filename, "anki_export.txt");
        assertEquals(markedIds, [1, 2]);
      },
      (err) => { throw new Error(`Expected ok, got: ${err.message}`); },
    );
  });

  it("should not mark exported when sendFile fails", async () => {
    let markExportedCalled = false;

    const readyCards: ReadyCard[] = [
      makeReadyCard(1, "apple", JSON.stringify({ word: "apple", meaning: "a fruit" })),
    ];

    const deps: ExportDeps = {
      cardRepo: mockCardRepo({
        findReadyByUserId: () => okAsync(readyCards),
        markExported: () => { markExportedCalled = true; return okAsync(undefined); },
      }),
      templateRepo: mockTemplateRepo(),
      notification: mockNotification({
        sendFile: () => errAsync({ kind: "notification" as const, message: "send failed" }),
      }),
    };

    const result = await handleExport({ userId: 1, chatId: "123" }, deps);

    result.match(
      () => { throw new Error("Expected error"); },
      (err) => {
        assertEquals(err.kind, "notification");
        assertEquals(markExportedCalled, false);
      },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env workers/api/handlers/export_command_test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement handleExport**

Create `workers/api/handlers/export_command.ts`:

```typescript
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type {
  CardRepositoryPort,
  ChatNotificationPort,
  ReadyCard,
  TemplateRepositoryPort,
} from "../../shared/mod.ts";
import type { ExportError, NotificationError, RepositoryError } from "../../shared/domain/errors.ts";
import { exportCards } from "../../shared/services/export_cards.ts";

export type ExportInput = {
  readonly userId: number;
  readonly chatId: string;
};

export type ExportResult = {
  readonly exported: number;
};

export type ExportDeps = {
  readonly cardRepo: CardRepositoryPort;
  readonly templateRepo: TemplateRepositoryPort;
  readonly notification: Pick<ChatNotificationPort, "sendFile">;
};

export function handleExport(
  input: ExportInput,
  deps: ExportDeps,
): ResultAsync<ExportResult, RepositoryError | ExportError | NotificationError> {
  return deps.cardRepo.findReadyByUserId(input.userId).andThen((readyCards) => {
    if (readyCards.length === 0) {
      return okAsync({ exported: 0 });
    }

    // Group by templateId (future-proof: iterate all groups)
    const groups = new Map<number, ReadyCard[]>();
    for (const card of readyCards) {
      const group = groups.get(card.templateId) ?? [];
      group.push(card);
      groups.set(card.templateId, group);
    }

    // Process all groups, concatenate TSV
    let allTsv = "";
    const allCardIds: number[] = [];

    // Chain through all template groups sequentially
    let chain: ResultAsync<void, RepositoryError | ExportError> = okAsync(undefined);
    for (const [templateId, cards] of groups.entries()) {
      chain = chain.andThen(() =>
        deps.templateRepo.findById(templateId).andThen((template) => {
          if (!template) {
            return errAsync<void, RepositoryError>({
              kind: "repository",
              message: `Template not found: ${templateId}`,
            });
          }

          const exportResult = exportCards({ cards, template });
          if (exportResult.isErr()) {
            return errAsync<void, ExportError>(exportResult.error);
          }

          if (allTsv.length > 0) allTsv += "\n";
          allTsv += exportResult.value.tsv;
          allCardIds.push(...exportResult.value.cardIds);
          return okAsync(undefined);
        })
      );
    }

    return chain.andThen(() => {
      const fileContent = new TextEncoder().encode(allTsv);
      return deps.notification
        .sendFile(input.chatId, fileContent, "anki_export.txt")
        .andThen(() => deps.cardRepo.markExported(allCardIds))
        .map((): ExportResult => ({ exported: allCardIds.length }));
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env workers/api/handlers/export_command_test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run full checks**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/api/handlers/export_command.ts workers/api/handlers/export_command_test.ts
git commit -m "feat(api): add /export handler with TDD"
```

---

## Task 9: Wire /export and Plain Text into Telegram Webhook

**Files:**
- Modify: `workers/api/adapters/telegram_webhook.ts`
- Modify: `workers/api/services/submit_word.ts`

- [ ] **Step 1: Update submitWord to use template fallback**

In `workers/api/services/submit_word.ts`, change `SubmitWordInput` to accept optional templateId and add template resolution:

```typescript
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
```

No change needed to the type — the templateId resolution happens in the webhook adapter before calling submitWord.

- [ ] **Step 2: Update telegram_webhook.ts**

Rewrite `workers/api/adapters/telegram_webhook.ts`:

```typescript
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv, CardRepositoryPort, TemplateRepositoryPort, UserRepositoryPort } from "../../shared/mod.ts";
import { D1CardRepository } from "../../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../../shared/adapters/d1_submission_repository.ts";
import { D1UserRepository } from "../../shared/adapters/d1_user_repository.ts";
import { D1TemplateRepository } from "../../shared/adapters/d1_template_repository.ts";
import { CfQueue } from "./cf_queue.ts";
import { createTelegramNotification } from "../../shared/adapters/telegram_notification.ts";
import { parseAddCommand } from "../handlers/add_command.ts";
import { submitWord, type SubmitWordDeps } from "../services/submit_word.ts";
import { handleExport, type ExportDeps } from "../handlers/export_command.ts";

let cachedBotInfo: UserFromGetMe | undefined;

export type WebhookOptions = {
  readonly botInfo?: UserFromGetMe;
  readonly deps?: SubmitWordDeps;
  readonly templateRepo?: TemplateRepositoryPort;
  readonly userRepo?: UserRepositoryPort;
  readonly exportDeps?: ExportDeps;
};

function buildDeps(env: ApiEnv): SubmitWordDeps {
  return {
    userRepo: new D1UserRepository(env.DB),
    cardRepo: new D1CardRepository(env.DB),
    submissionRepo: new D1SubmissionRepository(env.DB),
    queue: new CfQueue(env.EVENTS),
  };
}

async function resolveTemplateId(
  userRepo: UserRepositoryPort,
  templateRepo: TemplateRepositoryPort,
  userId: number,
): Promise<number | null> {
  const userResult = await userRepo.findByTelegramId(userId);
  if (userResult.isOk() && userResult.value?.activeTemplateId) {
    return userResult.value.activeTemplateId;
  }
  const defaultResult = await templateRepo.findDefault();
  if (defaultResult.isOk() && defaultResult.value) {
    return defaultResult.value.id;
  }
  return null;
}

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

  const deps = options?.deps ?? buildDeps(env);
  const templateRepo = options?.templateRepo ?? new D1TemplateRepository(env.DB);
  const userRepo = options?.userRepo ?? new D1UserRepository(env.DB);
  const notification = createTelegramNotification({ botToken: env.TELEGRAM_BOT_TOKEN });

  const exportDeps: ExportDeps = options?.exportDeps ?? {
    cardRepo: deps.cardRepo ?? new D1CardRepository(env.DB),
    templateRepo,
    notification,
  };

  registerAddCommand(bot, deps, userRepo, templateRepo);
  registerExportCommand(bot, exportDeps);
  registerPlainTextHandler(bot, deps, userRepo, templateRepo);

  const handler = webhookCallback(bot, "cloudflare-mod", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
  });
  return handler(req);
}

function registerAddCommand(
  bot: Bot,
  deps: SubmitWordDeps,
  userRepo: UserRepositoryPort,
  templateRepo: TemplateRepositoryPort,
): void {
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

    const templateId = await resolveTemplateId(userRepo, templateRepo, from.id);
    if (templateId === null) {
      await ctx.reply("No template configured. Please contact the administrator.");
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
        templateId,
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
}

function registerExportCommand(bot: Bot, deps: ExportDeps): void {
  bot.command("export", async (ctx) => {
    const from = ctx.from;
    if (!from) {
      await ctx.reply("Could not identify user.");
      return;
    }

    const result = await handleExport(
      { userId: from.id, chatId: String(ctx.chat.id) },
      deps,
    );

    await result.match(
      async (val) => {
        if (val.exported === 0) {
          await ctx.reply("No cards ready for export.");
        } else {
          await ctx.reply(`✅ Exported ${val.exported} card(s).`);
        }
      },
      async (err) => {
        console.error({ event: "export_failed", error: err.message, userId: from.id });
        await ctx.reply("Export failed. Please try again later.");
      },
    );
  });
}

function registerPlainTextHandler(
  bot: Bot,
  deps: SubmitWordDeps,
  userRepo: UserRepositoryPort,
  templateRepo: TemplateRepositoryPort,
): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const parsed = parseAddCommand(text);
    if (!parsed.ok) return; // Silent ignore

    const from = ctx.from;
    if (!from) return;

    const templateId = await resolveTemplateId(userRepo, templateRepo, from.id);
    if (templateId === null) return;

    const result = await submitWord(
      {
        userId: from.id,
        firstName: from.first_name,
        languageCode: null,
        word: parsed.word,
        sentence: parsed.sentence,
        chatId: String(ctx.chat.id),
        messageId: String(ctx.msg.message_id),
        templateId,
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
}
```

- [ ] **Step 3: Run checks and tests**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add workers/api/adapters/telegram_webhook.ts
git commit -m "feat(api): wire /export command and plain text handler into telegram webhook"
```

---

## Task 10: Error Handling & Retry in Processor

**Files:**
- Modify: `workers/processor/services/generate_card.ts`
- Modify: `workers/processor/index.ts`

- [ ] **Step 1: Add idempotency guard to generateCard**

In `workers/processor/services/generate_card.ts`, after finding the card, add a status check before `updateStatus(GENERATING)`:

```typescript
// After: if (!card) { ... }
// Add before: return deps.cardRepo.updateStatus(card.id, CARD_STATUS.GENERATING)

const terminalStatuses = [CARD_STATUS.READY, CARD_STATUS.EXPORTED, CARD_STATUS.FAILED] as const;
if ((terminalStatuses as readonly string[]).includes(card.status)) {
  return deps.submissionRepo.findById(card.submissionId).map((submission): GenerateCardResult => ({
    word: card.word,
    chatId: submission?.chatId ?? "",
    messageId: submission?.messageId ?? "",
    succeeded: card.status === CARD_STATUS.READY || card.status === CARD_STATUS.EXPORTED,
  }));
}
```

- [ ] **Step 2: Update processor queue handler with error classification**

In `workers/processor/index.ts`, replace the `try/catch/finally` with error-aware logic:

```typescript
import { classifyError } from "../shared/mod.ts";

// In the queue handler, replace the try/catch/finally block:
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
          console.log({
            event: res.succeeded ? "card_generated" : "card_generation_failed",
            cardId: msg.body.cardId,
            word: res.word,
            succeeded: res.succeeded,
            durationMs,
            ...(res.errorMessage ? { errorMessage: res.errorMessage } : {}),
          });

          const text = res.succeeded
            ? `✅ Card ready for <b>${escapeHtml(res.word)}</b>`
            : `❌ Failed to generate card for <b>${escapeHtml(res.word)}</b>`;

          ctx.waitUntil(notification.editMessage(res.chatId, res.messageId, text));
          msg.ack();
        } else {
          const classification = classifyError(result.error);
          console.error({
            event: "card_generation_error",
            cardId: msg.body.cardId,
            error: result.error.message,
            errorClassification: classification,
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
    // Safety net: unexpected throws get retried
    console.error({
      event: "queue_message_unexpected_error",
      type: msg.body.type,
      body: msg.body,
      error: err instanceof Error ? err.message : String(err),
    });
    msg.retry();
  }
}
```

Each branch explicitly calls `ack()` or `retry()`. The outer `try/catch` is a safety net for unexpected throws — retries by default since the failure is likely transient.

- [ ] **Step 3: Run checks and tests**

Run: `deno task check && deno task test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add workers/processor/
git commit -m "feat(processor): add error classification, retry/ack logic, and idempotency guard"
```

---

## Task 11: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all automated checks**

Run: `deno task check`
Expected: PASS (type-check + lint + format)

- [ ] **Step 2: Run all tests**

Run: `deno task test`
Expected: All tests PASS

- [ ] **Step 3: Verify structured log output**

Review code to ensure all significant events use JSON-serializable log objects, not bare strings.

- [ ] **Step 4: Commit any final fixes if needed**

```bash
git add -A
git commit -m "chore: final M5 integration verification fixes"
```

(Only if there were fixes needed. Skip if clean.)

- [ ] **Step 5: Document smoke test results**

Run smoke tests per spec §6.2 (requires local `.dev.vars`). Record pass/fail for each item.
