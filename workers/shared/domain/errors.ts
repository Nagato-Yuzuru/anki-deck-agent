export type LlmError = { readonly kind: "llm"; readonly message: string };
export type TtsError = { readonly kind: "tts"; readonly message: string };
export type NotificationError = { readonly kind: "notification"; readonly message: string };
export type RepositoryError = { readonly kind: "repository"; readonly message: string };
export type QueueError = { readonly kind: "queue"; readonly message: string };

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
