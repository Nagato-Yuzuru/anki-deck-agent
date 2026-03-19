import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseAddCommand } from "./add_command.ts";

describe("parseAddCommand", () => {
  it("should parse word and sentence with pipe separator", () => {
    const result = parseAddCommand("apple | I ate an apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should parse word and sentence with newline separator", () => {
    const result = parseAddCommand("apple\nI ate an apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should trim whitespace from word and sentence", () => {
    const result = parseAddCommand("  apple  |  I ate an apple  ");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple" });
  });

  it("should reject empty input", () => {
    const result = parseAddCommand("");
    assertEquals(result.ok, false);
  });

  it("should reject whitespace-only input", () => {
    const result = parseAddCommand("   ");
    assertEquals(result.ok, false);
  });

  it("should reject input without separator", () => {
    const result = parseAddCommand("apple");
    assertEquals(result.ok, false);
  });

  it("should reject empty word", () => {
    const result = parseAddCommand(" | I ate an apple");
    assertEquals(result.ok, false);
  });

  it("should reject empty sentence", () => {
    const result = parseAddCommand("apple | ");
    assertEquals(result.ok, false);
  });

  it("should use first pipe as separator when multiple pipes exist", () => {
    const result = parseAddCommand("apple | I ate an apple | it was good");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple | it was good" });
  });

  it("should use first newline as separator when multiple newlines exist", () => {
    const result = parseAddCommand("apple\nI ate an apple\nit was good");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate an apple\nit was good" });
  });

  it("should prefer pipe over newline when both present", () => {
    const result = parseAddCommand("apple | I ate\nan apple");
    assertEquals(result, { ok: true, word: "apple", sentence: "I ate\nan apple" });
  });
});
