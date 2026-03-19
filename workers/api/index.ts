import { Hono } from "@hono/hono";
import type { ApiEnv } from "../shared/mod.ts";

const app = new Hono<{ Bindings: ApiEnv }>();

app.get("/-/health", (c) => c.json({ status: "ok" }));

app.post("/webhook", async (c) => {
  const { handleWebhook } = await import("./adapters/telegram_webhook.ts");
  return handleWebhook(c.req.raw, c.env);
});

export default app;
