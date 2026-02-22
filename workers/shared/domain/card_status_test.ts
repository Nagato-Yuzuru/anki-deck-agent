import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CARD_STATUS, CARD_STATUSES } from "./card_status.ts";

describe("CardStatus", () => {
  it("should define all expected status values", () => {
    assertEquals(CARD_STATUS.PENDING, "pending");
    assertEquals(CARD_STATUS.READY, "ready");
    assertEquals(CARD_STATUS.SYNCED, "synced");
  });

  it("should list exactly three statuses", () => {
    assertEquals(CARD_STATUSES.length, 3);
  });
});
