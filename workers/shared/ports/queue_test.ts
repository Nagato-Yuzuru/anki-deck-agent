import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { GenerateDeckMessage, QueueMessage } from "./queue.ts";

describe("Queue contracts", () => {
  describe("GenerateDeckMessage", () => {
    it("should parse a valid message", () => {
      const result = GenerateDeckMessage.safeParse({
        type: "generate_deck",
        deckId: 1,
      });
      assertEquals(result.success, true);
    });

    it("should reject missing deckId", () => {
      const result = GenerateDeckMessage.safeParse({
        type: "generate_deck",
      });
      assertEquals(result.success, false);
    });

    it("should reject non-integer deckId", () => {
      const result = GenerateDeckMessage.safeParse({
        type: "generate_deck",
        deckId: 1.5,
      });
      assertEquals(result.success, false);
    });

    it("should reject deckId less than 1", () => {
      const result = GenerateDeckMessage.safeParse({
        type: "generate_deck",
        deckId: 0,
      });
      assertEquals(result.success, false);
    });
  });

  describe("QueueMessage (discriminated union)", () => {
    it("should parse a generate_deck message", () => {
      const result = QueueMessage.safeParse({
        type: "generate_deck",
        deckId: 42,
      });
      assertEquals(result.success, true);
    });

    it("should reject unknown message types", () => {
      const result = QueueMessage.safeParse({
        type: "unknown_type",
        deckId: 1,
      });
      assertEquals(result.success, false);
    });
  });
});
