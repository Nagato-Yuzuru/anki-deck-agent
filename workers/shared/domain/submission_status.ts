export const SUBMISSION_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
} as const;

export type SubmissionStatus = typeof SUBMISSION_STATUS[keyof typeof SUBMISSION_STATUS];

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = Object.values(SUBMISSION_STATUS);
