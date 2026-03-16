import type { ResultAsync } from "neverthrow";
import type { Card, CardStatus, CardUpdateFields, NewCard } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface CardRepositoryPort {
  findById(id: number): ResultAsync<Card | null, RepositoryError>;
  findBySubmissionId(submissionId: number): ResultAsync<readonly Card[], RepositoryError>;
  findActiveByUserIdAndWord(userId: number, word: string): ResultAsync<Card | null, RepositoryError>;
  create(card: NewCard): ResultAsync<Card, RepositoryError>;
  updateStatus(id: number, status: CardStatus, fields?: CardUpdateFields): ResultAsync<Card, RepositoryError>;
}
