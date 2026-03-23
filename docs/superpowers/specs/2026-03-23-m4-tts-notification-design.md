# M4: Telegram Notification After Card Processing

## Context

Milestone 4 was originally scoped to cover TTS audio generation and Telegram notifications. After design review, TTS was
descoped: modern Anki clients (desktop, AnkiDroid, iOS) natively support `{{tts lang:Field}}` template tags that invoke
system TTS at review time. Pre-generating audio adds storage cost (R2), API cost, and pipeline complexity with marginal
quality benefit. The `TtsPort` interface and `card.audioR2Key` schema field remain as extension points.

M4 now covers only **Issue #18: Telegram notification after card processing**.

## Problem

When a user sends `/add word | sentence`, the API worker replies with a "generating" message and enqueues a
`generate_card` job. The processor worker generates the card but provides no feedback to the user. The original Telegram
message remains stuck on "generating" indefinitely.

## Solution

After `generateCard` completes (success or failure), the processor edits the original Telegram message to reflect the
outcome.

### Notification Messages

- Success: `✅ Card ready for **{word}**`
- Failure: `❌ Failed to generate card for **{word}**`

## Architecture

### Layer Responsibility

```
processor/index.ts (handler layer)
  ├→ generateCard(cardId, deps) → GenerateCardResult
  ├→ Build notification text from result
  └→ notification.editMessage(chatId, messageId, text)
       └→ TelegramNotificationAdapter → fetch() Telegram Bot API
```

The handler layer orchestrates the notification as a post-processing step. `generateCard` remains a pure business-logic
service that knows nothing about Telegram. The notification adapter implements the existing `ChatNotificationPort`
interface.

### Data Flow

`generateCard` already queries the submission internally to resolve the template. The return type is extended to surface
the submission metadata needed for notification:

```typescript
type GenerateCardResult = {
  readonly word: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly succeeded: boolean;
};
```

On internal failure (card not found, submission not found, template not found), `generateCard` still returns an `Err`.
The handler constructs a fallback notification where possible.

### Notification Adapter

`TelegramNotificationAdapter` implements `ChatNotificationPort`:

```typescript
// POST https://api.telegram.org/bot<token>/editMessageText
// Body: { chat_id, message_id, text, parse_mode: "Markdown" }
```

- Direct `fetch()` call to Telegram Bot API — no grammY dependency in processor.
- Injectable `fetchFn` for testability (same pattern as `openai_llm.ts`).
- `sendFile` method implemented as a stub (`errAsync`) since M4 does not require file sending.

### Failure Strategy

Notification is best-effort. It must not affect card generation status in D1.

1. First attempt fails → retry once after no delay.
2. Second attempt fails → log structured error, move on.
3. Card status in D1 is already committed before notification runs.

Retry is implemented in the adapter, not in the handler. The handler calls `editMessage` once; the adapter internally
retries.

## File Changes

| Action | File                                                       | Description                                                       |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Create | `workers/processor/adapters/telegram_notification.ts`      | Implements `ChatNotificationPort` via Telegram Bot API REST calls |
| Create | `workers/processor/adapters/telegram_notification_test.ts` | Mock fetch, verify request shape, retry logic, error handling     |
| Modify | `workers/processor/services/generate_card.ts`              | Return `GenerateCardResult` instead of `void`                     |
| Modify | `workers/processor/services/generate_card_test.ts`         | Update assertions for new return type                             |
| Modify | `workers/processor/index.ts`                               | Add notification orchestration after generateCard                 |
| Modify | `workers/processor/index_test.ts`                          | Test notification invocation and failure degradation              |

## Design Decisions

### Why not grammY in processor?

The processor is a queue consumer. Importing grammY adds ~50KB of unused bot framework for a single `editMessageText`
call. A direct `fetch` is lighter and consistent with `openai_llm.ts`.

### Why retry in the adapter, not the handler?

The adapter owns the transport concern. The handler should not know about HTTP retry semantics. This keeps the handler
focused on orchestration.

### Why not propagate notification errors?

Card generation is the primary operation; notification is a side effect. If notification fails, the card is still ready
in D1. The user can check card status via other means (future `/status` command, or simply re-submitting).

### Why extend generateCard return type instead of querying again?

`generateCard` already fetches the submission internally. Returning `GenerateCardResult` surfaces data that's already in
memory, avoiding a redundant D1 query in the handler.

## Out of Scope

- TTS audio generation (descoped from M4; see Issues #16, #17 — closed)
- `sendFile` implementation on `ChatNotificationPort` (stub only)
- Submission status aggregation (deferred, single-card scope)
- Rich notification formatting beyond success/failure
