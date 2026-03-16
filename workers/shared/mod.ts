// Domain
export type { CardStatus } from "./domain/card_status.ts";
export { CARD_STATUS, CARD_STATUSES } from "./domain/card_status.ts";
export type { SubmissionStatus } from "./domain/submission_status.ts";
export { SUBMISSION_STATUS, SUBMISSION_STATUSES } from "./domain/submission_status.ts";
export type { Language } from "./domain/language.ts";
export { LANGUAGE, LANGUAGES } from "./domain/language.ts";
export type { NewUser, User } from "./domain/user.ts";
export type { Card, CardUpdateFields, NewCard } from "./domain/card.ts";
export type { CardTemplate } from "./domain/card_template.ts";
export type { NewSubmission, Submission, SubmissionUpdateFields } from "./domain/submission.ts";
export type { LlmError, NotificationError, QueueError, RepositoryError, TtsError } from "./domain/errors.ts";

// DB schema (adapter-only)
export { cards, cardTemplates, submissions, users } from "./db/schema.ts";
export type {
  InsertCard,
  InsertCardTemplate,
  InsertSubmission,
  InsertUser,
  SelectCard,
  SelectCardTemplate,
  SelectSubmission,
  SelectUser,
} from "./db/schema.ts";

// Queue contracts
export { GenerateCardMessage, QueueMessage } from "./ports/queue.ts";

// Port interfaces
export type { QueuePort } from "./ports/queue.ts";
export type { LlmPort } from "./ports/llm.ts";
export type { TtsPort } from "./ports/tts.ts";
export type { ChatNotificationPort } from "./ports/chat_notification.ts";
export type { CardRepositoryPort } from "./ports/card_repository.ts";
export type { SubmissionRepositoryPort } from "./ports/submission_repository.ts";
export type { UserRepositoryPort } from "./ports/user_repository.ts";

// Env bindings
export type { ApiEnv, BaseEnv, ProcessorEnv } from "./env.ts";
