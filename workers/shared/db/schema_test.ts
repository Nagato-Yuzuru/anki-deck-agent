import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getTableColumns, getTableName } from "drizzle-orm";
import { cards, cardTemplates, submissions, users } from "./schema.ts";

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

  describe("submissions table", () => {
    it("should be named 'submissions'", () => {
      assertEquals(getTableName(submissions), "submissions");
    });

    it("should have the expected columns", () => {
      const cols = Object.keys(getTableColumns(submissions)).sort();
      assertEquals(cols, [
        "chatId",
        "createdAt",
        "errorMessage",
        "id",
        "messageId",
        "status",
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
        "audioR2Key",
        "createdAt",
        "errorMessage",
        "id",
        "llmResponseJson",
        "sentence",
        "status",
        "submissionId",
        "updatedAt",
        "word",
      ]);
    });
  });
});
