import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { NewUser, User } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { UserRepositoryPort } from "../ports/user_repository.ts";
import { users } from "../db/schema.ts";

export class D1UserRepository implements UserRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  upsert(user: NewUser): ResultAsync<User, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(users)
        .values({
          telegramId: user.telegramId,
          firstName: user.firstName,
          languageCode: user.languageCode,
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set: { firstName: user.firstName, languageCode: user.languageCode },
        })
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findByTelegramId(telegramId: number): ResultAsync<User | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateActiveTemplate(telegramId: number, templateId: number | null): ResultAsync<User, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(users)
        .set({ activeTemplateId: templateId })
        .where(eq(users.telegramId, telegramId))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      telegramId: row.telegramId,
      firstName: row.firstName,
      languageCode: row.languageCode,
      activeTemplateId: row.activeTemplateId ?? null,
      createdAt: row.createdAt,
    };
  }
}
