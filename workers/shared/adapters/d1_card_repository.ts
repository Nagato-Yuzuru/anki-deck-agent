import { and, eq, inArray, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { okAsync, ResultAsync } from "neverthrow";
import type { Card, CardStatus, CardUpdateFields, NewCard, ReadyCard } from "../domain/mod.ts";
import { CARD_STATUS } from "../domain/card_status.ts";
import type { RepositoryError } from "../domain/errors.ts";
import type { CardRepositoryPort } from "../ports/card_repository.ts";
import { cards, submissions } from "../db/schema.ts";

const TERMINAL_STATUSES: CardStatus[] = [CARD_STATUS.EXPORTED, CARD_STATUS.FAILED];

export class D1CardRepository implements CardRepositoryPort {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  findById(id: number): ResultAsync<Card | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cards)
        .where(eq(cards.id, id))
        .then((rows) => (rows[0] ? this.toDomain(rows[0]) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select()
        .from(cards)
        .where(eq(cards.submissionId, submissionId))
        .then((rows) => rows.map((r) => this.toDomain(r))),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findActiveByUserIdAndWord(userId: number, word: string): ResultAsync<Card | null, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select({ card: cards })
        .from(cards)
        .innerJoin(submissions, eq(cards.submissionId, submissions.id))
        .where(
          and(
            eq(submissions.userId, userId),
            eq(cards.word, word),
            notInArray(cards.status, TERMINAL_STATUSES),
          ),
        )
        .limit(1)
        .then((rows) => (rows[0] ? this.toDomain(rows[0].card) : null)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  create(card: NewCard): ResultAsync<Card, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .insert(cards)
        .values({
          submissionId: card.submissionId,
          word: card.word,
          sentence: card.sentence,
        })
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  updateStatus(id: number, status: CardStatus, fields?: CardUpdateFields): ResultAsync<Card, RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .update(cards)
        .set({ status, ...fields, updatedAt: new Date().toISOString() })
        .where(eq(cards.id, id))
        .returning()
        .then((rows) => this.toDomain(rows[0]!)),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  findReadyByUserId(userId: number): ResultAsync<readonly ReadyCard[], RepositoryError> {
    return ResultAsync.fromPromise(
      this.db
        .select({ card: cards, templateId: submissions.templateId })
        .from(cards)
        .innerJoin(submissions, eq(cards.submissionId, submissions.id))
        .where(
          and(
            eq(submissions.userId, userId),
            eq(cards.status, CARD_STATUS.READY),
          ),
        )
        .then((rows) => rows.map((r) => ({ ...this.toDomain(r.card), templateId: r.templateId }))),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  markExported(ids: readonly number[]): ResultAsync<void, RepositoryError> {
    if (ids.length === 0) return okAsync(undefined);
    return ResultAsync.fromPromise(
      this.db
        .update(cards)
        .set({ status: CARD_STATUS.EXPORTED, updatedAt: new Date().toISOString() })
        .where(and(inArray(cards.id, [...ids]), eq(cards.status, CARD_STATUS.READY)))
        .then(() => undefined),
      (err): RepositoryError => ({ kind: "repository", message: String(err) }),
    );
  }

  private toDomain(row: typeof cards.$inferSelect): Card {
    return {
      id: row.id,
      submissionId: row.submissionId,
      word: row.word,
      sentence: row.sentence,
      status: row.status,
      llmResponseJson: row.llmResponseJson,
      audioR2Key: row.audioR2Key,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
