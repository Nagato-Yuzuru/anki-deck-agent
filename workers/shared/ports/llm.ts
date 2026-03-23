import type { ResultAsync } from "neverthrow";
import type { LlmError } from "../domain/errors.ts";

export interface LlmPort {
  generateStructured(prompt: string, jsonSchema: string): ResultAsync<unknown, LlmError>;
}
