import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { D1TemplateRepository } from "./d1_template_repository.ts";

describe("D1TemplateRepository", () => {
  describe("toDomain", () => {
    it("maps Drizzle row to CardTemplate domain type", () => {
      const row = {
        id: 1,
        name: "ja-en-basic",
        promptTemplate: "Translate {word}: {sentence}",
        responseJsonSchema: '{"type":"object"}',
        ankiNoteType: "Basic",
        ankiFieldsMapping: '{"front":"word","back":"translation"}',
        isActive: 1,
        createdAt: "2026-01-01T00:00:00Z",
      };

      const result = D1TemplateRepository.toDomain(row);

      assertEquals(result.id, 1);
      assertEquals(result.name, "ja-en-basic");
      assertEquals(result.promptTemplate, "Translate {word}: {sentence}");
      assertEquals(result.isActive, true);
    });

    it("converts isActive 0 to false", () => {
      const row = {
        id: 2,
        name: "inactive",
        promptTemplate: "",
        responseJsonSchema: "{}",
        ankiNoteType: "Basic",
        ankiFieldsMapping: "{}",
        isActive: 0,
        createdAt: "2026-01-01T00:00:00Z",
      };

      assertEquals(D1TemplateRepository.toDomain(row).isActive, false);
    });
  });
});
