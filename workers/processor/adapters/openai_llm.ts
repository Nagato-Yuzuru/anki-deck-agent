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
      } catch {
        return errAsync({
          kind: "llm" as const,
          message: `Invalid JSON schema: ${jsonSchema}`,
        });
      }

      return ResultAsync.fromPromise(
        fetchFn(`${config.gatewayUrl}/chat/completions`, {
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
          ).andThen((body) =>
            errAsync<never, LlmError>({
              kind: "llm",
              message: `HTTP ${response.status}: ${body}`,
            })
          );
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
            (): LlmError => ({
              kind: "llm",
              message: `LLM response is not valid JSON: ${content.slice(0, 200)}`,
            }),
          );
        });
      });
    },
  };
}
