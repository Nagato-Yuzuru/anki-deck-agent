import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import processor from "./index.ts";

function mockMessage(body: unknown): {
  body: unknown;
  ack: () => void;
  retry: () => void;
  acked: boolean;
} {
  const msg = {
    body,
    acked: false,
    ack(): void {
      this.acked = true;
    },
    retry(): void {},
  };
  return msg;
}

function mockBatch(messages: ReturnType<typeof mockMessage>[]): {
  messages: typeof messages;
  queue: string;
} {
  return { messages, queue: "test-queue" };
}

const mockEnv = {
  DB: {} as never,
  ASSETS: {} as never,
  TELEGRAM_BOT_TOKEN: "test-token",
  AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/test",
  OPENAI_API_KEY: "sk-test",
  LLM_MODEL: "gpt-4o",
  TTS_API_URL: "https://tts.example.com",
  TTS_API_KEY: "tts-key",
};

const mockCtx = {
  waitUntil: (): void => {},
  passThroughOnException: (): void => {},
} as never;

describe("Processor queue consumer", () => {
  it("exports a queue handler", () => {
    assertEquals(typeof processor.queue, "function");
  });

  it("acks generate_card messages", async () => {
    const msg = mockMessage({ type: "generate_card", cardId: 1 });
    const batch = mockBatch([msg]);

    await processor.queue(batch as never, mockEnv as never, mockCtx);

    assertEquals(msg.acked, true);
  });

  it("acks unknown message types without throwing", async () => {
    const msg = mockMessage({ type: "unknown_type" });
    const batch = mockBatch([msg]);

    await processor.queue(batch as never, mockEnv as never, mockCtx);

    assertEquals(msg.acked, true);
  });

  it("processes generate_card message without throwing (DB mock fails gracefully)", async () => {
    const msg = mockMessage({ type: "generate_card", cardId: 1 });
    const batch = mockBatch([msg]);

    // DB is mocked as empty object — generateCard will fail internally, but should not throw
    await processor.queue(batch as never, mockEnv as never, mockCtx);

    assertEquals(msg.acked, true);
  });
});
