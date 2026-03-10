import type { D1Database, Queue, R2Bucket } from "./types/cloudflare.ts";

export interface Env {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly EVENTS: Queue;
  readonly TELEGRAM_BOT_TOKEN: string;
}
