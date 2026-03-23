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

- Success: `✅ Card ready for <b>{word}</b>`
- Failure: `❌ Failed to generate card for <b>{word}</b>`

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

**Ok/Err boundary:** `generateCard` returns `Ok(GenerateCardResult)` for all business outcomes — both successful
generation (`succeeded: true`) and handled failures like LLM errors (`succeeded: false`, card already marked `FAILED` in
D1). `Err` is reserved for unrecoverable infrastructure errors (e.g., D1 connection lost mid-operation).

**Error paths where notification metadata is unavailable:**

- **Card not found:** No submission to query → `Err`. Handler cannot notify (no chatId). Log and move on.
- **Submission not found:** Card exists (`word` known) but no chatId/messageId → `Err`. Handler cannot notify. Log and
  move on.
- **Template not found:** Card and submission both fetched → `Ok({ succeeded: false, ... })` with chatId/messageId
  available. Handler sends failure notification.
- **LLM failure:** All metadata available → `Ok({ succeeded: false, ... })`. Handler sends failure notification.
- **LLM success:** → `Ok({ succeeded: true, ... })`. Handler sends success notification.

The handler sends notification only when it receives `Ok` (chatId/messageId guaranteed present). On `Err`, the handler
logs the error and skips notification — these are rare infrastructure failures where we have no way to reach the user.

**Notification port stays out of `GenerateCardDeps`.** The service must not know about notifications. The handler
constructs and calls the notification adapter directly.

### Notification Adapter

`TelegramNotificationAdapter` implements `ChatNotificationPort`:

```typescript
// POST https://api.telegram.org/bot<token>/editMessageText
// Body: { chat_id, message_id, text, parse_mode: "HTML" }
```

- Uses `HTML` parse mode (not legacy `Markdown`) to avoid escaping issues with user-provided words containing `_`, `*`,
  `[`, etc. Notification text uses `<b>word</b>` for bold.
- Direct `fetch()` call to Telegram Bot API — no grammY dependency in processor.
- `TELEGRAM_BOT_TOKEN` is already available on `ProcessorEnv` via `BaseEnv` — no wrangler config changes needed.
- Injectable `fetchFn` for testability (same pattern as `openai_llm.ts`).
- `sendFile` method implemented as a stub (`errAsync`) since M4 does not require file sending.

### Failure Strategy

Notification is best-effort. It must not affect card generation status in D1.

1. First attempt fails (non-2xx HTTP response OR fetch exception) → retry once immediately.
2. Second attempt fails → log structured error, return `Ok(void)` to handler (swallow the error).
3. Card status in D1 is already committed before notification runs.

Retry is implemented in the adapter, not in the handler. The handler calls `editMessage` once; the adapter internally
retries. Known benign failure: Telegram returns 400 when the original message was deleted by the user — this is logged
and ignored like any other failure.

### Structured Log Events

| Event                 | Level   | When                           |
| --------------------- | ------- | ------------------------------ |
| `notification_sent`   | `log`   | Telegram API returned 2xx      |
| `notification_retry`  | `warn`  | First attempt failed, retrying |
| `notification_failed` | `error` | Both attempts failed           |

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
- Idempotency guard for duplicate queue delivery (pre-existing concern, not introduced by M4)
