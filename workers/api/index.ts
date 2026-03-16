import { Hono } from "@hono/hono";
import type { ApiEnv } from "../shared/mod.ts";
import { handleWebhook } from "./adapters/telegram_webhook.ts";

const app = new Hono<{ Bindings: ApiEnv }>();

app.get("/-/health", (c) => c.json({ status: "ok" }));

app.post("/webhook", (c) => handleWebhook(c.req.raw, c.env));

export default app;
