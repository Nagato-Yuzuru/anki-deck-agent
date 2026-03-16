import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CARD_STATUS, CARD_STATUSES } from "./card_status.ts";

describe("CardStatus", () => {
  it("should define all expected status values", () => {
    assertEquals(CARD_STATUS.PENDING, "pending");
    assertEquals(CARD_STATUS.GENERATING, "generating");
    assertEquals(CARD_STATUS.READY, "ready");
    assertEquals(CARD_STATUS.EXPORTED, "exported");
    assertEquals(CARD_STATUS.FAILED, "failed");
  });

  it("should list exactly five statuses", () => {
    assertEquals(CARD_STATUSES.length, 5);
  });
});
