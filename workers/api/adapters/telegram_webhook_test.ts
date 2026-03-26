import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type { Transformer } from "grammy";
import { handleWebhook, type WebhookDeps } from "./telegram_webhook.ts";
import { makeTelegramUpdate, mockApiEnv, mockBotInfo } from "../test_helpers.ts";
import type { CardTemplate } from "../../shared/domain/mod.ts";
import type { Card } from "../../shared/domain/card.ts";
import type { NewSubmission, Submission } from "../../shared/domain/submission.ts";
import type { User } from "../../shared/domain/user.ts";

function makeReq(body: Record<string, unknown>, secretToken = "test-webhook-secret"): Request {
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secretToken,
    },
    body: JSON.stringify(body),
  });
}

function makeAddUpdate(word: string): Record<string, unknown> {
  return makeTelegramUpdate({
    message: {
      message_id: 2,
      from: { id: 12345, is_bot: false, first_name: "Test" },
      chat: { id: 12345, type: "private" },
      date: 1234567890,
      text: `/add ${word}`,
      entities: [{ offset: 0, length: 4, type: "bot_command" }],
    },
  });
}

function makePlainTextUpdate(text: string): Record<string, unknown> {
  return makeTelegramUpdate({
    message: {
      message_id: 3,
      from: { id: 12345, is_bot: false, first_name: "Test" },
      chat: { id: 12345, type: "private" },
      date: 1234567890,
      text,
    },
  });
}

const defaultTemplate: CardTemplate = {
  id: 1,
  name: "Default",
  promptTemplate: "...",
  responseJsonSchema: "{}",
  ankiNoteType: "Basic",
  ankiFieldsMapping: "{}",
  isActive: true,
  createdAt: "2024-01-01",
};

const defaultUser: User = {
  telegramId: 12345,
  firstName: "Test",
  languageCode: null,
  activeTemplateId: null,
  createdAt: "2024-01-01",
};

const defaultCard: Card = {
  id: 1,
  submissionId: 1,
  word: "word",
  sentence: "",
  status: "pending",
  llmResponseJson: null,
  audioR2Key: null,
  errorMessage: null,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

const defaultSubmission: Submission = {
  id: 1,
  userId: 12345,
  templateId: 1,
  chatId: "12345",
  messageId: "1",
  status: "pending",
  errorMessage: null,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

function makeTestDeps(overrides?: Partial<WebhookDeps>): WebhookDeps {
  return {
    userRepo: {
      upsert: () => okAsync(defaultUser),
      findByTelegramId: () => okAsync(null),
      updateActiveTemplate: () => okAsync(defaultUser),
    },
    cardRepo: {
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => okAsync(defaultCard),
      updateStatus: () => okAsync(defaultCard),
      findReadyByUserId: () => okAsync([]),
      markExported: () => okAsync(undefined),
    },
    submissionRepo: {
      findById: () => okAsync(null),
      create: () => okAsync(defaultSubmission),
      updateStatus: () => okAsync(defaultSubmission),
    },
    queue: { send: () => okAsync(undefined) },
    templateRepo: {
      findById: () => okAsync(defaultTemplate),
      findDefault: () => okAsync(defaultTemplate),
      create: () => okAsync(defaultTemplate),
    },
    ...overrides,
  };
}

// Mocks Telegram API so ctx.reply/editMessageText don't make real network calls.
const mockTelegramApi: Transformer = (_prev, method, _payload) => {
  if (method === "sendMessage") {
    return Promise.resolve({
      ok: true,
      result: {
        message_id: 42,
        from: { id: 123, is_bot: true, first_name: "TestBot" },
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "...",
      },
      // deno-lint-ignore no-explicit-any
    }) as any;
  }
  // deno-lint-ignore no-explicit-any
  return Promise.resolve({ ok: true, result: true }) as any;
};

describe("handleWebhook", () => {
  it("should return 200 for a valid Telegram update", async () => {
    const res = await handleWebhook(makeReq(makeTelegramUpdate()), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });

  it("should return 200 for an unknown update (grammY ignores it)", async () => {
    const res = await handleWebhook(makeReq({ update_id: 999 }), mockApiEnv(), { botInfo: mockBotInfo() });
    assertEquals(res.status, 200);
  });

  it("should return 401 for an invalid secret token", async () => {
    const res = await handleWebhook(makeReq(makeTelegramUpdate(), "wrong-secret"), mockApiEnv(), {
      botInfo: mockBotInfo(),
    });
    assertEquals(res.status, 401);
  });

  describe("/add command — template resolution", () => {
    it("does not enqueue when template repo returns error", async () => {
      let queueSendCalled = false;
      const deps = makeTestDeps({
        queue: {
          send: () => {
            queueSendCalled = true;
            return okAsync(undefined);
          },
        },
        templateRepo: {
          findById: () => okAsync(null),
          findDefault: () => errAsync({ kind: "repository" as const, message: "DB error" }),
          create: () => okAsync(defaultTemplate),
        },
      });
      const res = await handleWebhook(makeReq(makeAddUpdate("word | context sentence")), mockApiEnv(), {
        botInfo: mockBotInfo(),
        deps,
        apiTransformer: mockTelegramApi,
      });
      assertEquals(res.status, 200);
      assertEquals(queueSendCalled, false);
    });

    it("does not enqueue when no active template exists", async () => {
      let queueSendCalled = false;
      const deps = makeTestDeps({
        queue: {
          send: () => {
            queueSendCalled = true;
            return okAsync(undefined);
          },
        },
        templateRepo: {
          findById: () => okAsync(null),
          findDefault: () => okAsync(null),
          create: () => okAsync(defaultTemplate),
        },
      });
      const res = await handleWebhook(makeReq(makeAddUpdate("word | context sentence")), mockApiEnv(), {
        botInfo: mockBotInfo(),
        deps,
        apiTransformer: mockTelegramApi,
      });
      assertEquals(res.status, 200);
      assertEquals(queueSendCalled, false);
    });

    it("enqueues with the user's activeTemplateId when set", async () => {
      let capturedTemplateId: number | undefined;
      const deps = makeTestDeps({
        userRepo: {
          upsert: () => okAsync(defaultUser),
          findByTelegramId: () => okAsync({ ...defaultUser, activeTemplateId: 5 }),
          updateActiveTemplate: () => okAsync(defaultUser),
        },
        templateRepo: {
          findById: (id) => okAsync({ ...defaultTemplate, id }),
          findDefault: () => okAsync(defaultTemplate),
          create: () => okAsync(defaultTemplate),
        },
        submissionRepo: {
          findById: () => okAsync(null),
          create: (sub: NewSubmission) => {
            capturedTemplateId = sub.templateId;
            return okAsync({ ...defaultSubmission, templateId: sub.templateId });
          },
          updateStatus: () => okAsync(defaultSubmission),
        },
        queue: { send: () => okAsync(undefined) },
      });
      await handleWebhook(makeReq(makeAddUpdate("word | context sentence")), mockApiEnv(), {
        botInfo: mockBotInfo(),
        deps,
        apiTransformer: mockTelegramApi,
      });
      assertEquals(capturedTemplateId, 5);
    });
  });

  describe("plain text message — template resolution", () => {
    it("does not enqueue when template repo returns error", async () => {
      let queueSendCalled = false;
      const deps = makeTestDeps({
        queue: {
          send: () => {
            queueSendCalled = true;
            return okAsync(undefined);
          },
        },
        templateRepo: {
          findById: () => okAsync(null),
          findDefault: () => errAsync({ kind: "repository" as const, message: "DB error" }),
          create: () => okAsync(defaultTemplate),
        },
      });
      const res = await handleWebhook(makeReq(makePlainTextUpdate("word | context sentence")), mockApiEnv(), {
        botInfo: mockBotInfo(),
        deps,
        apiTransformer: mockTelegramApi,
      });
      assertEquals(res.status, 200);
      assertEquals(queueSendCalled, false);
    });

    it("does not enqueue when no active template exists", async () => {
      let queueSendCalled = false;
      const deps = makeTestDeps({
        queue: {
          send: () => {
            queueSendCalled = true;
            return okAsync(undefined);
          },
        },
        templateRepo: {
          findById: () => okAsync(null),
          findDefault: () => okAsync(null),
          create: () => okAsync(defaultTemplate),
        },
      });
      const res = await handleWebhook(makeReq(makePlainTextUpdate("word | context sentence")), mockApiEnv(), {
        botInfo: mockBotInfo(),
        deps,
        apiTransformer: mockTelegramApi,
      });
      assertEquals(res.status, 200);
      assertEquals(queueSendCalled, false);
    });
  });
});
