import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { CardTemplate } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { TemplateRepositoryPort } from "../ports/template_repository.ts";
import { cardTemplates } from "../db/schema.ts";

export class D1TemplateRepository implements TemplateRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cardTemplates)
        .where(eq(cardTemplates.id, id))
        .then((rows) => (rows[0] ? D1TemplateRepository.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  static toDomain(row: typeof cardTemplates.$inferSelect): CardTemplate {
    return {
      id: row.id,
      name: row.name,
      promptTemplate: row.promptTemplate,
      responseJsonSchema: row.responseJsonSchema,
      ankiNoteType: row.ankiNoteType,
      ankiFieldsMapping: row.ankiFieldsMapping,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
    };
  }
}
