import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { ResultAsync } from "neverthrow";
import type { NewSubmission, Submission, SubmissionStatus, SubmissionUpdateFields } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { SubmissionRepositoryPort } from "../ports/submission_repository.ts";
import { submissions } from "../db/schema.ts";

export class D1SubmissionRepository implements SubmissionRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<Submission | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, id))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  create(submission: NewSubmission): ResultAsync<Submission, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(submissions)
        .values({
          userId: submission.userId,
          templateId: submission.templateId,
          chatId: submission.chatId,
          messageId: submission.messageId,
        })
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateStatus(
    id: number,
    status: SubmissionStatus,
    fields?: SubmissionUpdateFields,
  ): ResultAsync<Submission, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(submissions)
        .set({ status, ...fields, updatedAt: new Date().toISOString() })
        .where(eq(submissions.id, id))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof submissions.$inferSelect): Submission {
    return {
      id: row.id,
      userId: row.userId,
      templateId: row.templateId,
      chatId: row.chatId,
      messageId: row.messageId,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
