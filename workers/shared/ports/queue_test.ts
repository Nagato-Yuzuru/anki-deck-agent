import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { GenerateCardMessage, QueueMessage } from "./queue.ts";

describe("Queue contracts", () => {
  describe("GenerateCardMessage", () => {
    it("should parse a valid message", () => {
      const result = GenerateCardMessage.safeParse({
        type: "generate_card",
        cardId: 1,
      });
      assertEquals(result.success, true);
    });

    it("should reject missing cardId", () => {
      const result = GenerateCardMessage.safeParse({
        type: "generate_card",
      });
      assertEquals(result.success, false);
    });

    it("should reject non-integer cardId", () => {
      const result = GenerateCardMessage.safeParse({
        type: "generate_card",
        cardId: 1.5,
      });
      assertEquals(result.success, false);
    });

    it("should reject cardId less than 1", () => {
      const result = GenerateCardMessage.safeParse({
        type: "generate_card",
        cardId: 0,
      });
      assertEquals(result.success, false);
    });
  });

  describe("QueueMessage (discriminated union)", () => {
    it("should parse a generate_card message", () => {
      const result = QueueMessage.safeParse({
        type: "generate_card",
        cardId: 42,
      });
      assertEquals(result.success, true);
    });

    it("should reject unknown message types", () => {
      const result = QueueMessage.safeParse({
        type: "unknown_type",
        cardId: 1,
      });
      assertEquals(result.success, false);
    });
  });
});
