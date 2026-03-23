import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type {
  Card,
  CardRepositoryPort,
  CardTemplate,
  LlmPort,
  NewCard,
  Submission,
  SubmissionRepositoryPort,
  TemplateRepositoryPort,
} from "../../shared/mod.ts";
import type { LlmError, RepositoryError } from "../../shared/domain/errors.ts";
import { generateCard, type GenerateCardDeps } from "./generate_card.ts";

const sampleCard: Card = {
  id: 1,
  submissionId: 10,
  word: "apple",
  sentence: "I ate an apple",
  status: "pending",
  llmResponseJson: null,
  audioR2Key: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sampleSubmission: Submission = {
  id: 10,
  userId: 100,
  templateId: 5,
  chatId: "12345",
  messageId: "1",
  status: "pending",
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sampleTemplate: CardTemplate = {
  id: 5,
  name: "ja-en-basic",
  promptTemplate: "Translate the word '{word}' given the sentence: '{sentence}'",
  responseJsonSchema: '{"type":"object","properties":{"translation":{"type":"string"}}}',
  ankiNoteType: "Basic",
  ankiFieldsMapping: '{"front":"word","back":"translation"}',
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleLlmResponse = { translation: "りんご" };

function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(sampleCard),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: (_c: NewCard) => okAsync(sampleCard),
    updateStatus: (_id, _status, _fields?) => okAsync({ ...sampleCard, status: _status, ..._fields }),
    ...overrides,
  };
}

function mockSubmissionRepo(overrides?: Partial<SubmissionRepositoryPort>): SubmissionRepositoryPort {
  return {
    findById: () => okAsync(sampleSubmission),
    create: () => okAsync(sampleSubmission),
    updateStatus: () => okAsync(sampleSubmission),
    ...overrides,
  };
}

function mockTemplateRepo(overrides?: Partial<TemplateRepositoryPort>): TemplateRepositoryPort {
  return {
    findById: () => okAsync(sampleTemplate),
    ...overrides,
  };
}

function mockLlm(overrides?: Partial<LlmPort>): LlmPort {
  return {
    generateStructured: () => okAsync(sampleLlmResponse),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<GenerateCardDeps>): GenerateCardDeps {
  return {
    cardRepo: mockCardRepo(),
    submissionRepo: mockSubmissionRepo(),
    templateRepo: mockTemplateRepo(),
    llm: mockLlm(),
    ...overrides,
  };
}

describe("generateCard", () => {
  it("happy path: fetches card, builds prompt, calls LLM, updates status to ready", async () => {
    const statusUpdates: { status: string; fields?: unknown }[] = [];

    const result = await generateCard(
      1,
      makeDeps({
        cardRepo: mockCardRepo({
          updateStatus: (_id, status, fields?) => {
            statusUpdates.push({ status, fields });
            return okAsync({ ...sampleCard, status, ...fields });
          },
        }),
      }),
    );

    result.match(
      () => {
        assertEquals(statusUpdates.length, 2);
        assertEquals(statusUpdates[0]!.status, "generating");
        assertEquals(statusUpdates[1]!.status, "ready");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("verifies prompt contains word and sentence from card", async () => {
    let capturedPrompt = "";

    await generateCard(
      1,
      makeDeps({
        llm: mockLlm({
          generateStructured: (prompt, _schema) => {
            capturedPrompt = prompt;
            return okAsync(sampleLlmResponse);
          },
        }),
      }),
    );

    assertEquals(capturedPrompt.includes("apple"), true);
    assertEquals(capturedPrompt.includes("I ate an apple"), true);
  });

  it("returns error when card not found", async () => {
    const result = await generateCard(
      999,
      makeDeps({
        cardRepo: mockCardRepo({ findById: () => okAsync(null) }),
      }),
    );

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
      },
    );
  });

  it("marks card as failed when LLM call fails", async () => {
    const llmErr: LlmError = { kind: "llm", message: "API timeout" };
    let failedUpdate: { status: string; fields?: unknown } | undefined;

    const result = await generateCard(
      1,
      makeDeps({
        llm: mockLlm({ generateStructured: () => errAsync(llmErr) }),
        cardRepo: mockCardRepo({
          updateStatus: (_id, status, fields?) => {
            if (status === "failed") {
              failedUpdate = { status, fields };
            }
            return okAsync({ ...sampleCard, status, ...fields });
          },
        }),
      }),
    );

    result.match(
      () => {
        assertEquals(failedUpdate?.status, "failed");
      },
      (err) => {
        assertEquals(err.kind, "llm");
        assertEquals(failedUpdate?.status, "failed");
      },
    );
  });

  it("marks card as failed when submission not found", async () => {
    let markedFailed = false;

    const result = await generateCard(
      1,
      makeDeps({
        submissionRepo: mockSubmissionRepo({ findById: () => okAsync(null) }),
        cardRepo: mockCardRepo({
          updateStatus: (_id, status, _fields?) => {
            if (status === "failed") markedFailed = true;
            return okAsync({ ...sampleCard, status });
          },
        }),
      }),
    );

    result.match(
      () => assertEquals(markedFailed, true),
      (err) => assertEquals(err.kind, "repository"),
    );
  });

  it("marks card as failed when template not found", async () => {
    let markedFailed = false;

    const result = await generateCard(
      1,
      makeDeps({
        templateRepo: mockTemplateRepo({ findById: () => okAsync(null) }),
        cardRepo: mockCardRepo({
          updateStatus: (_id, status, _fields?) => {
            if (status === "failed") markedFailed = true;
            return okAsync({ ...sampleCard, status });
          },
        }),
      }),
    );

    result.match(
      () => assertEquals(markedFailed, true),
      (err) => assertEquals(err.kind, "repository"),
    );
  });

  it("propagates error when updateStatus to generating fails", async () => {
    const repoErr: RepositoryError = { kind: "repository", message: "DB locked" };

    const result = await generateCard(
      1,
      makeDeps({
        cardRepo: mockCardRepo({
          updateStatus: () => errAsync(repoErr),
        }),
      }),
    );

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
        assertEquals(err.message, "DB locked");
      },
    );
  });
});
