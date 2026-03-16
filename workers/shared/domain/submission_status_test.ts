import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SUBMISSION_STATUS, SUBMISSION_STATUSES } from "./submission_status.ts";

describe("SubmissionStatus", () => {
  it("should define all expected status values", () => {
    assertEquals(SUBMISSION_STATUS.PENDING, "pending");
    assertEquals(SUBMISSION_STATUS.PROCESSING, "processing");
    assertEquals(SUBMISSION_STATUS.DONE, "done");
    assertEquals(SUBMISSION_STATUS.FAILED, "failed");
  });

  it("should list exactly four statuses", () => {
    assertEquals(SUBMISSION_STATUSES.length, 4);
  });
});
