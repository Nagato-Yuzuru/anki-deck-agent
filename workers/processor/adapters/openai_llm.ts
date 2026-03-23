import { errAsync, ResultAsync } from "neverthrow";
import type { LlmPort } from "../../shared/mod.ts";
import type { LlmError } from "../../shared/domain/errors.ts";

export type OpenAiLlmConfig = {
  readonly gatewayUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof fetch;
};

export function createOpenAiLlm(config: OpenAiLlmConfig): LlmPort {
  const fetchFn = config.fetchFn ?? globalThis.fetch;

  return {
    generateStructured(
      prompt: string,
      jsonSchema: string,
    ): ResultAsync<unknown, LlmError> {
      let parsedSchema: unknown;
      try {
        parsedSchema = JSON.parse(jsonSchema);
      } catch (e) {
        const parseError = e instanceof Error ? e.message : String(e);
        return errAsync({
          kind: "llm" as const,
          message: `Invalid JSON schema: ${parseError} (input: ${jsonSchema.slice(0, 200)})`,
        });
      }

      const baseUrl = config.gatewayUrl.replace(/\/+$/, "");

      return ResultAsync.fromPromise(
        fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: "user", content: prompt }],
            response_format: {
              type: "json_schema",
              json_schema: { name: "response", schema: parsedSchema, strict: true },
            },
          }),
        }),
        (err): LlmError => ({
          kind: "llm",
          message: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ).andThen((response) => {
        if (!response.ok) {
          return ResultAsync.fromPromise(
            response.text(),
            (): LlmError => ({ kind: "llm", message: `HTTP ${response.status}` }),
          ).andThen((body) => {
            console.error({ event: "llm_http_error", status: response.status, body });
            return errAsync<never, LlmError>({
              kind: "llm",
              message: `HTTP ${response.status}: ${body.slice(0, 200)}`,
            });
          });
        }

        return ResultAsync.fromPromise(
          response.json() as Promise<{
            choices: { message: { content: string } }[];
          }>,
          (err): LlmError => ({
            kind: "llm",
            message: `Response parse failed: ${String(err)}`,
          }),
        ).andThen((data) => {
          const content = data.choices[0]?.message?.content;
          if (!content) {
            return errAsync<never, LlmError>({
              kind: "llm",
              message: "Empty response from LLM",
            });
          }

          return ResultAsync.fromPromise(
            Promise.resolve().then(() => JSON.parse(content) as unknown),
            (): LlmError => {
              console.error({ event: "llm_invalid_json", content: content.slice(0, 500) });
              return {
                kind: "llm",
                message: "LLM response is not valid JSON",
              };
            },
          );
        });
      });
    },
  };
}
