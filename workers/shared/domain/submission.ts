import type { SubmissionStatus } from "./submission_status.ts";

export type Submission = {
  readonly id: number;
  readonly userId: number;
  readonly templateId: number;
  readonly chatId: string;
  readonly messageId: string;
  readonly status: SubmissionStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NewSubmission = Omit<Submission, "id" | "status" | "errorMessage" | "createdAt" | "updatedAt">;

export type SubmissionUpdateFields = Partial<Pick<Submission, "errorMessage">>;
