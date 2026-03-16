import type { ResultAsync } from "neverthrow";
import type { Language } from "../domain/language.ts";
import type { TtsError } from "../domain/errors.ts";

export interface TtsPort {
  synthesize(text: string, language: Language): ResultAsync<Uint8Array, TtsError>;
}
