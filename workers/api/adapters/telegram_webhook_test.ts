import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handleWebhook } from "./telegram_webhook.ts";
import { makeTelegramUpdate, mockApiEnv, mockBotInfo } from "../test_helpers.ts";

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleWebhook", () => {
  it("should return 200 for a valid Telegram update", async () => {
    const res = await handleWebhook(makeReq(makeTelegramUpdate()), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });

  it("should return 200 for an unknown update (grammY ignores it)", async () => {
    const res = await handleWebhook(makeReq({ update_id: 999 }), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });
});
