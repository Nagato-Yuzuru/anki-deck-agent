import type { NewCardTemplate } from "../domain/mod.ts";

export const DEFAULT_TEMPLATE: NewCardTemplate = {
  name: "Vocabulary",
  promptTemplate: `You are a language learning assistant. The user is learning vocabulary.

Word: {word}
Context sentence: {sentence}

Based on the word and context, generate a flashcard with:
- The word itself
- Pronunciation/reading in the target language's phonetic system (if applicable)
- Meaning explained in the context language
- An example sentence in the source language
- The same example translated to the target language
- Any helpful notes about usage, etymology, or common mistakes

Respond in JSON matching the provided schema.`,
  responseJsonSchema: JSON.stringify({
    type: "object",
    properties: {
      word: { type: "string" },
      reading: { type: "string" },
      meaning: { type: "string" },
      example_source: { type: "string" },
      example_target: { type: "string" },
      notes: { type: "string" },
    },
    required: ["word", "reading", "meaning", "example_source", "example_target", "notes"],
  }),
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({
    Front: "word",
    Reading: "reading",
    Meaning: "meaning",
    ExampleSource: "example_source",
    ExampleTarget: "example_target",
    Notes: "notes",
  }),
  isActive: true,
};
