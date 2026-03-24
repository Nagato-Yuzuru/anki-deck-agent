import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiEnv } from "../../shared/mod.ts";
import { D1CardRepository } from "../../shared/adapters/d1_card_repository.ts";
import { D1SubmissionRepository } from "../../shared/adapters/d1_submission_repository.ts";
import { D1UserRepository } from "../../shared/adapters/d1_user_repository.ts";
import { D1TemplateRepository } from "../../shared/adapters/d1_template_repository.ts";
import { createTelegramNotification } from "../../shared/adapters/telegram_notification.ts";
import { CfQueue } from "./cf_queue.ts";
import { parseAddCommand } from "../handlers/add_command.ts";
import { submitWord, type SubmitWordDeps } from "../services/submit_word.ts";
import { type ExportCommandDeps, handleExportCommand } from "../handlers/export_command.ts";

// Cache per isolate — immutable bot metadata, not mutable application state.
let cachedBotInfo: UserFromGetMe | undefined;

const DEFAULT_TEMPLATE_ID = 1;

export type WebhookOptions = {
  readonly botInfo?: UserFromGetMe;
  readonly deps?: SubmitWordDeps;
  readonly exportDeps?: ExportCommandDeps;
};

function buildDeps(env: ApiEnv): SubmitWordDeps {
  return {
    userRepo: new D1UserRepository(env.DB),
    cardRepo: new D1CardRepository(env.DB),
    submissionRepo: new D1SubmissionRepository(env.DB),
    queue: new CfQueue(env.EVENTS),
  };
}

function buildExportDeps(env: ApiEnv): ExportCommandDeps {
  return {
    cardRepo: new D1CardRepository(env.DB),
    templateRepo: new D1TemplateRepository(env.DB),
    chatNotification: createTelegramNotification({ botToken: env.TELEGRAM_BOT_TOKEN }),
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
  registerExportCommand(bot, env, options);

  const handler = webhookCallback(bot, "cloudflare-mod", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
  });
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

    const sentMsg = await ctx.reply(`⏳ Generating card for "${parsed.word}"...`);

    const result = await submitWord(
      {
        userId: from.id,
        firstName: from.first_name,
        languageCode: null,
        word: parsed.word,
        sentence: parsed.sentence,
        chatId: String(ctx.chat.id),
        messageId: String(sentMsg.message_id),
        templateId: DEFAULT_TEMPLATE_ID,
      },
      deps,
    );

    await result.match(
      async (val) => {
        if (!val.isNew) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            sentMsg.message_id,
            `Card for "${parsed.word}" already exists (status: ${val.existingStatus}).`,
          );
        }
      },
      async (err) => {
        console.error({ event: "submit_word_failed", error: err.message, userId: from.id });
        await ctx.api.editMessageText(
          ctx.chat.id,
          sentMsg.message_id,
          "Something went wrong. Please try again later.",
        );
      },
    );
  });

  bot.on("message:text", async (ctx) => {
    // Plain text — treat same as /add
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return; // skip commands
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

    const sentMsg = await ctx.reply(`⏳ Generating card for "${parsed.word}"...`);

    const result = await submitWord(
      {
        userId: from.id,
        firstName: from.first_name,
        languageCode: null,
        word: parsed.word,
        sentence: parsed.sentence,
        chatId: String(ctx.chat.id),
        messageId: String(sentMsg.message_id),
        templateId: DEFAULT_TEMPLATE_ID,
      },
      deps,
    );
    await result.match(
      async (val) => {
        if (!val.isNew) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            sentMsg.message_id,
            `Card for "${parsed.word}" already exists (status: ${val.existingStatus}).`,
          );
        }
      },
      async (err) => {
        console.error({ event: "submit_word_failed", error: err.message, userId: from.id });
        await ctx.api.editMessageText(
          ctx.chat.id,
          sentMsg.message_id,
          "Something went wrong. Please try again later.",
        );
      },
    );
  });
}

function registerExportCommand(bot: Bot, env: ApiEnv, options?: WebhookOptions): void {
  bot.command("export", async (ctx) => {
    const from = ctx.from;
    if (!from) {
      await ctx.reply("Could not identify user.");
      return;
    }
    const exportDeps = options?.exportDeps ?? buildExportDeps(env);
    const result = await handleExportCommand(
      {
        userId: from.id,
        chatId: String(ctx.chat.id),
      },
      exportDeps,
    );
    await result.match(
      async () => {/* success handled inside handler via notification */},
      async (err) => {
        if (err.kind === "export") {
          await ctx.reply(err.message);
        } else {
          console.error({ event: "export_failed", error: err.message, userId: from.id });
          await ctx.reply("Export failed. Please try again later.");
        }
      },
    );
  });
}
