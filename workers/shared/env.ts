import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly EVENTS: Queue;
  readonly TELEGRAM_BOT_TOKEN: string;
}
