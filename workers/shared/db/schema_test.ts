import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getTableColumns, getTableName } from "drizzle-orm";
import { cards, cardTemplates, decks, users } from "./schema.ts";

describe("D1 Schema", () => {
  describe("users table", () => {
    it("should be named 'users'", () => {
      assertEquals(getTableName(users), "users");
    });

    it("should have the expected columns", () => {
      const cols = Object.keys(getTableColumns(users)).sort();
      assertEquals(cols, ["createdAt", "firstName", "languageCode", "telegramId"]);
    });
  });

  describe("card_templates table", () => {
    it("should be named 'card_templates'", () => {
      assertEquals(getTableName(cardTemplates), "card_templates");
    });

    it("should have the expected columns", () => {
      const cols = Object.keys(getTableColumns(cardTemplates)).sort();
      assertEquals(cols, [
        "ankiFieldsMapping",
        "ankiNoteType",
        "createdAt",
        "id",
        "isActive",
        "name",
        "promptTemplate",
        "responseJsonSchema",
      ]);
    });
  });

  describe("decks table", () => {
    it("should be named 'decks'", () => {
      assertEquals(getTableName(decks), "decks");
    });

    it("should have the expected columns", () => {
      const cols = Object.keys(getTableColumns(decks)).sort();
      assertEquals(cols, [
        "createdAt",
        "errorMessage",
        "id",
        "status",
        "telegramChatId",
        "telegramMessageId",
        "templateId",
        "updatedAt",
        "userId",
      ]);
    });
  });

  describe("cards table", () => {
    it("should be named 'cards'", () => {
      assertEquals(getTableName(cards), "cards");
    });

    it("should have the expected columns", () => {
      const cols = Object.keys(getTableColumns(cards)).sort();
      assertEquals(cols, [
        "ankiNoteId",
        "audioR2Key",
        "createdAt",
        "deckId",
        "id",
        "sentence",
        "status",
        "word",
      ]);
    });
  });
});
