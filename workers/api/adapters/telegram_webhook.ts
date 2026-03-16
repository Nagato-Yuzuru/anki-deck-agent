import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv } from "../../shared/mod.ts";
import { D1CardRepository } from "../../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../../shared/adapters/d1_submission_repository.ts";
import { D1UserRepository } from "../../shared/adapters/d1_user_repository.ts";
import { CfQueue } from "./cf_queue.ts";
import { parseAddCommand } from "../handlers/add_command.ts";
import { submitWord, type SubmitWordDeps } from "../services/submit_word.ts";

// Cache per isolate — immutable bot metadata, not mutable application state.
let cachedBotInfo: UserFromGetMe | undefined;

const DEFAULT_TEMPLATE_ID = 1;

export type WebhookOptions = {
  readonly botInfo?: UserFromGetMe;
  readonly deps?: SubmitWordDeps;
};

function buildDeps(env: ApiEnv): SubmitWordDeps {
  return {
    userRepo: new D1UserRepository(env.DB),
    cardRepo: new D1CardRepository(env.DB),
    submissionRepo: new D1SubmissionRepository(env.DB),
    queue: new CfQueue(env.EVENTS),
  };
}

export async function handleWebhook(
  req: Request,
  env: ApiEnv,
  options?: WebhookOptions,
): Promise<Response> {
  const botInfo = options?.botInfo ?? cachedBotInfo;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { botInfo });

  if (botInfo === undefined) {
    await bot.init();
    cachedBotInfo = bot.botInfo;
  }

  const deps = options?.deps ?? buildDeps(env);
  registerAddCommand(bot, deps);

  const handler = webhookCallback(bot, "cloudflare-mod");
  return handler(req);
}

function registerAddCommand(bot: Bot, deps: SubmitWordDeps): void {
  bot.command("add", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /add word | sentence");
      return;
    }

    const parsed = parseAddCommand(text);
    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const from = ctx.from;
    if (!from) {
      await ctx.reply("Could not identify user.");
      return;
    }

    const result = await submitWord(
      {
        userId: from.id,
        firstName: from.first_name,
        languageCode: null,
        word: parsed.word,
        sentence: parsed.sentence,
        chatId: String(ctx.chat.id),
        messageId: String(ctx.msg.message_id),
        templateId: DEFAULT_TEMPLATE_ID,
      },
      deps,
    );

    await result.match(
      async (val) => {
        if (val.isNew) {
          await ctx.reply(`Generating card for "${parsed.word}"...`);
        } else {
          await ctx.reply(`Card for "${parsed.word}" already exists (status: ${val.existingStatus}).`);
        }
      },
      async (err) => {
        console.error({ event: "submit_word_failed", error: err.message, userId: from.id });
        await ctx.reply("Something went wrong. Please try again later.");
      },
    );
  });
}
