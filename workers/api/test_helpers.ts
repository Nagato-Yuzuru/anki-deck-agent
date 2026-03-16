import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv } from "../shared/mod.ts";

export function mockApiEnv(overrides?: Partial<ApiEnv>): ApiEnv {
  return {
    DB: {} as D1Database,
    ASSETS: {} as R2Bucket,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    EVENTS: { send: () => Promise.resolve() } as unknown as Queue,
    ...overrides,
  };
}

export function makeTelegramUpdate(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    update_id: 123,
    message: {
      message_id: 1,
      from: { id: 12345, is_bot: false, first_name: "Test" },
      chat: { id: 12345, type: "private" },
      date: 1234567890,
      text: "/start",
    },
    ...overrides,
  };
}

export function mockBotInfo(): UserFromGetMe {
  return {
    id: 123,
    is_bot: true,
    first_name: "TestBot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  };
}
