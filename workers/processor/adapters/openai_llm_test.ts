import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createOpenAiLlm } from "./openai_llm.ts";

const baseConfig = {
  gatewayUrl: "https://gateway.ai.cloudflare.com/v1/acc/gw/openai",
  apiKey: "sk-test-key",
  model: "gpt-4o",
};

function successFetch(responseContent: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(responseContent) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;
}

function errorFetch(status: number, body: string): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(body, { status }),
    )) as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (() => Promise.reject(new Error("Network error"))) as typeof fetch;
}

describe("OpenAI LLM adapter", () => {
  it("sends correct request shape to AI Gateway", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"translation":"hello"}' } }],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: mockFetch });
    await llm.generateStructured("test prompt", '{"type":"object"}');

    assertEquals(capturedUrl, "https://gateway.ai.cloudflare.com/v1/acc/gw/openai/chat/completions");

    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.model, "gpt-4o");
    assertEquals(body.messages[0].role, "user");
    assertEquals(body.messages[0].content, "test prompt");
    assertEquals(body.response_format.type, "json_schema");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer sk-test-key");
  });

  it("parses successful LLM response", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: successFetch({ translation: "りんご" }),
    });

    const result = await llm.generateStructured("translate apple", '{"type":"object"}');

    result.match(
      (val) => {
        assertEquals((val as Record<string, string>).translation, "りんご");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("returns LlmError on HTTP error", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: errorFetch(429, "Rate limited"),
    });

    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("429"), true);
      },
    );
  });

  it("returns LlmError on network failure", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: failingFetch(),
    });

    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
      },
    );
  });

  it("returns LlmError on malformed JSON schema from D1", async () => {
    const llm = createOpenAiLlm({
      ...baseConfig,
      fetchFn: successFetch({}),
    });

    const result = await llm.generateStructured("test", "not valid json{{{");

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("schema"), true, `Expected message to mention schema, got: ${err.message}`);
      },
    );
  });

  it("returns LlmError when choices array is empty", async () => {
    const emptyChoicesFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [] }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: emptyChoicesFetch });
    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(err.message.includes("Empty"), true);
      },
    );
  });

  it("returns LlmError when response content is not valid JSON", async () => {
    const badFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not json at all" } }],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const llm = createOpenAiLlm({ ...baseConfig, fetchFn: badFetch });
    const result = await llm.generateStructured("test", '{"type":"object"}');

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "llm");
      },
    );
  });
});
