export type LlmError = { readonly kind: "llm"; readonly message: string };
export type TtsError = { readonly kind: "tts"; readonly message: string };
export type NotificationError = { readonly kind: "notification"; readonly message: string };
export type RepositoryError = { readonly kind: "repository"; readonly message: string };
export type QueueError = { readonly kind: "queue"; readonly message: string };
