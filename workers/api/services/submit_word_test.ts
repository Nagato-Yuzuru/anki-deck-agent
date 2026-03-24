import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type {
  Card,
  CardRepositoryPort,
  NewCard,
  QueuePort,
  SubmissionRepositoryPort,
  UserRepositoryPort,
} from "../../shared/mod.ts";
import type { QueueError, RepositoryError } from "../../shared/domain/errors.ts";
import type { QueueMessage } from "../../shared/ports/queue.ts";
import { submitWord, type SubmitWordResult } from "./submit_word.ts";

function mockUserRepo(overrides?: Partial<UserRepositoryPort>): UserRepositoryPort {
  const user = {
    telegramId: 100,
    firstName: "Test",
    languageCode: null,
    activeTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  return {
    upsert: () => okAsync(user),
    findByTelegramId: () => okAsync(user),
    updateActiveTemplate: () => okAsync(user),
    ...overrides,
  };
}

function mockCardRepo(overrides?: Partial<CardRepositoryPort>): CardRepositoryPort {
  return {
    findById: () => okAsync(null),
    findBySubmissionId: () => okAsync([]),
    findActiveByUserIdAndWord: () => okAsync(null),
    create: (_card: NewCard) =>
      okAsync({
        id: 1,
        submissionId: 1,
        word: "apple",
        sentence: "I ate an apple",
        status: "pending" as const,
        llmResponseJson: null,
        audioR2Key: null,
        errorMessage: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    updateStatus: () => okAsync({} as Card),
    findReadyByUserId: () => okAsync([]),
    markExported: () => okAsync(undefined),
    ...overrides,
  };
}

function mockSubmissionRepo(overrides?: Partial<SubmissionRepositoryPort>): SubmissionRepositoryPort {
  return {
    findById: () => okAsync(null),
    create: (sub) =>
      okAsync({
        id: 1,
        ...sub,
        status: "pending" as const,
        errorMessage: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    updateStatus: () => okAsync({} as never),
    ...overrides,
  };
}

function mockQueuePort(overrides?: Partial<QueuePort>): QueuePort {
  return {
    send: () => okAsync(undefined),
    ...overrides,
  };
}

const baseInput = {
  userId: 100,
  firstName: "Test",
  languageCode: null as null,
  word: "apple",
  sentence: "I ate an apple",
  chatId: "12345",
  messageId: "1",
  templateId: 1,
};

describe("submitWord", () => {
  it("should create a new card and enqueue generation when no duplicate exists", async () => {
    let enqueuedMessage: QueueMessage | undefined;
    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort({
        send: (msg) => {
          enqueuedMessage = msg;
          return okAsync(undefined);
        },
      }),
    });

    result.match(
      (val: SubmitWordResult) => {
        assertEquals(val.isNew, true);
        assertEquals(val.cardId, 1);
      },
      (err: RepositoryError | QueueError) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
    assertEquals(enqueuedMessage?.type, "generate_card");
  });

  it("should return existing card info when duplicate is found", async () => {
    const existingCard: Card = {
      id: 42,
      submissionId: 10,
      word: "apple",
      sentence: "I ate an apple",
      status: "generating",
      llmResponseJson: null,
      audioR2Key: null,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo({ findActiveByUserIdAndWord: () => okAsync(existingCard) }),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort(),
    });

    result.match(
      (val: SubmitWordResult) => {
        assertEquals(val.isNew, false);
        assertEquals(val.cardId, 42);
        assertEquals(val.existingStatus, "generating");
      },
      (err: RepositoryError | QueueError) => {
        throw new Error(`Expected ok, got error: ${err.message}`);
      },
    );
  });

  it("should propagate repository errors", async () => {
    const repoErr: RepositoryError = { kind: "repository", message: "DB down" };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo({ upsert: () => errAsync(repoErr) }),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort(),
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err: RepositoryError | QueueError) => {
        assertEquals(err.kind, "repository");
      },
    );
  });

  it("should propagate queue errors", async () => {
    const queueErr: QueueError = { kind: "queue", message: "Queue full" };

    const result = await submitWord(baseInput, {
      userRepo: mockUserRepo(),
      cardRepo: mockCardRepo(),
      submissionRepo: mockSubmissionRepo(),
      queue: mockQueuePort({ send: () => errAsync(queueErr) }),
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err: RepositoryError | QueueError) => {
        assertEquals(err.kind, "queue");
      },
    );
  });
});
