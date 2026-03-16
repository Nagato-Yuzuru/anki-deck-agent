import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface BaseEnv {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly TELEGRAM_BOT_TOKEN: string;
}

export interface ApiEnv extends BaseEnv {
  readonly EVENTS: Queue;
}

export interface ProcessorEnv extends BaseEnv {
  readonly AI: Ai;
  readonly TTS_API_URL: string;
  readonly TTS_API_KEY: string;
}
