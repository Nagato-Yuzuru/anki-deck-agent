import type { Language } from "./language.ts";

export type User = {
  readonly telegramId: number;
  readonly firstName: string;
  readonly languageCode: Language | null;
  readonly createdAt: string;
};
