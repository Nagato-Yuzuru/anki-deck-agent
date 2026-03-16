import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CardStatus } from "../domain/card_status.ts";
import type { Language } from "../domain/language.ts";
import type { SubmissionStatus } from "../domain/submission_status.ts";

export const users = sqliteTable("users", {
  telegramId: integer("telegram_id").primaryKey(),
  firstName: text("first_name").notNull(),
  languageCode: text("language_code").$type<Language>(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const cardTemplates = sqliteTable("card_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  promptTemplate: text("prompt_template").notNull(),
  responseJsonSchema: text("response_json_schema").notNull(),
  ankiNoteType: text("anki_note_type").notNull(),
  ankiFieldsMapping: text("anki_fields_mapping").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const submissions = sqliteTable("submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.telegramId),
  templateId: integer("template_id").notNull().references(() => cardTemplates.id),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id").notNull(),
  status: text("status").$type<SubmissionStatus>().notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submissionId: integer("submission_id").notNull().references(() => submissions.id),
  word: text("word").notNull(),
  sentence: text("sentence").notNull(),
  status: text("status").$type<CardStatus>().notNull().default("pending"),
  llmResponseJson: text("llm_response_json"),
  audioR2Key: text("audio_r2_key"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export type SelectUser = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SelectCardTemplate = typeof cardTemplates.$inferSelect;
export type InsertCardTemplate = typeof cardTemplates.$inferInsert;
export type SelectSubmission = typeof submissions.$inferSelect;
export type InsertSubmission = typeof submissions.$inferInsert;
export type SelectCard = typeof cards.$inferSelect;
export type InsertCard = typeof cards.$inferInsert;
