import type { ResultAsync } from "neverthrow";
import type { NewSubmission, Submission, SubmissionStatus, SubmissionUpdateFields } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface SubmissionRepositoryPort {
  findById(id: number): ResultAsync<Submission | null, RepositoryError>;
  create(submission: NewSubmission): ResultAsync<Submission, RepositoryError>;
  updateStatus(
    id: number,
    status: SubmissionStatus,
    fields?: SubmissionUpdateFields,
  ): ResultAsync<Submission, RepositoryError>;
}
