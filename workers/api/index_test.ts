import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import app from "./index.ts";

describe("API Worker", () => {
  describe("GET /-/health", () => {
    it("should return 200 with status ok", async () => {
      const res = await app.request("/-/health");
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { status: "ok" });
    });
  });

  describe("unknown route", () => {
    it("should return 404", async () => {
      const res = await app.request("/nonexistent");
      assertEquals(res.status, 404);
    });
  });
});
