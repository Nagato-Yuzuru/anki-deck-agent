import type { ResultAsync } from "neverthrow";
import type { LlmError } from "../domain/errors.ts";

export interface LlmPort {
  generateStructured<T>(prompt: string, jsonSchema: string): ResultAsync<T, LlmError>;
}
