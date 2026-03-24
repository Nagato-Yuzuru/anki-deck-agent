import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Card, CardTemplate } from "../domain/mod.ts";
import { exportCards } from "./export_cards.ts";

const template: CardTemplate = {
  id: 1,
  name: "Vocabulary",
  promptTemplate: "",
  responseJsonSchema: "",
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({
    Front: "word",
    Meaning: "meaning",
    Notes: "notes",
  }),
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function makeCard(id: number, llmResponseJson: string | null): Card {
  return {
    id,
    submissionId: 1,
    word: "test",
    sentence: "test sentence",
    status: "ready",
    llmResponseJson,
    audioR2Key: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("exportCards", () => {
  it("should generate TSV from cards with valid JSON", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, JSON.stringify({ word: "book", meaning: "a text", notes: "noun" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [1, 2]);
        const lines = val.tsv.split("\n");
        assertEquals(lines[0], "apple\ta fruit\tcommon");
        assertEquals(lines[1], "book\ta text\tnoun");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should skip cards with null llmResponseJson", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, null),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [1]);
        assertEquals(val.tsv, "apple\ta fruit\tcommon");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should skip cards with unparseable JSON", () => {
    const cards = [
      makeCard(1, "not json"),
      makeCard(2, JSON.stringify({ word: "book", meaning: "a text", notes: "" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.cardIds, [2]);
        assertEquals(val.tsv, "book\ta text\t");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should sanitize tabs and newlines in field values", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "test\tword", meaning: "line1\nline2", notes: "ok\rok" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.tsv, "test word\tline1 line2\tok ok");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should return ExportError when all cards have invalid JSON", () => {
    const cards = [makeCard(1, null), makeCard(2, "bad json")];

    const result = exportCards({ cards, template });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "export");
      },
    );
  });

  it("should handle missing fields in JSON by using empty string", () => {
    const cards = [
      makeCard(1, JSON.stringify({ word: "apple" })),
    ];

    const result = exportCards({ cards, template });

    result.match(
      (val) => {
        assertEquals(val.tsv, "apple\t\t");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });
});
