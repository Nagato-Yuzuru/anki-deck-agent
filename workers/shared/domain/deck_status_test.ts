import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DECK_STATUS, DECK_STATUSES } from "./deck_status.ts";

describe("DeckStatus", () => {
  it("should define all expected status values", () => {
    assertEquals(DECK_STATUS.PENDING, "pending");
    assertEquals(DECK_STATUS.PROCESSING, "processing");
    assertEquals(DECK_STATUS.DONE, "done");
    assertEquals(DECK_STATUS.FAILED, "failed");
  });

  it("should list exactly four statuses", () => {
    assertEquals(DECK_STATUSES.length, 4);
  });
});
