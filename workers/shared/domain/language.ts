export const LANGUAGE = {
  EN: "en",
  JA: "ja",
} as const;

export type Language = typeof LANGUAGE[keyof typeof LANGUAGE];

export const LANGUAGES: readonly Language[] = Object.values(LANGUAGE);
