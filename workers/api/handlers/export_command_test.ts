import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type { CardRepositoryPort } from "../../shared/ports/card_repository.ts";
import type { TemplateRepositoryPort } from "../../shared/ports/template_repository.ts";
import type { ChatNotificationPort } from "../../shared/ports/chat_notification.ts";
import type { Card, CardTemplate, ReadyCard } from "../../shared/domain/mod.ts";
import { type ExportCommandInput, handleExportCommand } from "./export_command.ts";

const mockTemplate: CardTemplate = {
  id: 1,
  name: "Vocabulary",
  promptTemplate: "",
  responseJsonSchema: "",
  ankiNoteType: "Vocabulary",
  ankiFieldsMapping: JSON.stringify({
    Front: "word",
    Meaning: "meaning",
    Notes: "notes",
  }),
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const mockTemplate2: CardTemplate = {
  id: 2,
  name: "Sentence",
  promptTemplate: "",
  responseJsonSchema: "",
  ankiNoteType: "Sentence",
  ankiFieldsMapping: JSON.stringify({
    Sentence: "sentence",
    Translation: "translation",
  }),
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function makeCard(id: number, templateId: number, llmResponseJson: string | null): ReadyCard {
  const card: Card = {
    id,
    submissionId: 1,
    word: "test",
    sentence: "test sentence",
    status: "ready",
    llmResponseJson,
    audioR2Key: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return { ...card, templateId };
}

describe("handleExportCommand", () => {
  it("should successfully export cards with a single template group", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, 1, JSON.stringify({ word: "book", meaning: "a text", notes: "noun" })),
    ];

    let sentFile: Uint8Array | null = null;
    let sentFilename: string | null = null;

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: (_chatId, file, filename) => {
        sentFile = file;
        sentFilename = filename;
        return okAsync(undefined);
      },
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        assertEquals(sentFilename, "anki_export.txt");
        const content = new TextDecoder().decode(sentFile!);
        const lines = content.split("\n");
        assertEquals(lines[0], "apple\ta fruit\tcommon");
        assertEquals(lines[1], "book\ta text\tnoun");
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.kind} - ${err.message}`);
      },
    );
  });

  it("should successfully export cards grouped by multiple templates", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, 2, JSON.stringify({ sentence: "Hello world", translation: "你好世界" })),
      makeCard(3, 1, JSON.stringify({ word: "book", meaning: "a text", notes: "noun" })),
    ];

    let sentFile: Uint8Array | null = null;

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        if (id === 2) return okAsync(mockTemplate2);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: (_chatId, file) => {
        sentFile = file;
        return okAsync(undefined);
      },
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        const content = new TextDecoder().decode(sentFile!);
        const lines = content.split("\n");
        // Should have both groups' cards
        assertEquals(lines.length, 3);
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.kind} - ${err.message}`);
      },
    );
  });

  it("should return export error when no cards are ready", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync([]),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: () => okAsync(mockTemplate),
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => {
        throw new Error("should not be called");
      },
      sendFile: () => {
        throw new Error("should not be called");
      },
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "export");
        assertEquals(err.message, "No cards ready for export.");
      },
    );
  });

  it("should propagate repository error from findReadyByUserId", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => errAsync({ kind: "repository", message: "DB connection failed" }),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: () => okAsync(mockTemplate),
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => okAsync(undefined),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
        assertEquals(err.message, "DB connection failed");
      },
    );
  });

  it("should propagate export error when exportCards fails", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, null),
      makeCard(2, 1, "not json"),
    ];

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => okAsync(undefined),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "export");
        assertEquals(err.message, "No valid cards to export");
      },
    );
  });

  it("should propagate notification error from sendFile", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
    ];

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: () => okAsync(undefined),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => errAsync({ kind: "notification", message: "Telegram API error" }),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "notification");
        assertEquals(err.message, "Telegram API error");
      },
    );
  });

  it("should mark cards as exported only after successful send", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
      makeCard(2, 1, JSON.stringify({ word: "book", meaning: "a text", notes: "noun" })),
    ];

    let markedIds: readonly number[] | null = null;

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: (ids) => {
        markedIds = ids;
        return okAsync(undefined);
      },
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => okAsync(undefined),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        assertEquals(markedIds, [1, 2]);
      },
      (err) => {
        throw new Error(`Expected ok, got error: ${err.kind} - ${err.message}`);
      },
    );
  });

  it("should not mark cards if send fails", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
    ];

    let markedIds: readonly number[] | null = null;

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: (ids) => {
        markedIds = ids;
        return okAsync(undefined);
      },
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => errAsync({ kind: "notification", message: "Send failed" }),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      () => {
        assertEquals(markedIds, null);
      },
    );
  });

  it("should propagate repository error from markExported", async () => {
    const input: ExportCommandInput = {
      userId: 123,
      chatId: "456",
    };

    const cards = [
      makeCard(1, 1, JSON.stringify({ word: "apple", meaning: "a fruit", notes: "common" })),
    ];

    const mockCardRepo: CardRepositoryPort = {
      findReadyByUserId: () => okAsync(cards),
      markExported: () => errAsync({ kind: "repository", message: "Update failed" }),
      findById: () => okAsync(null),
      findBySubmissionId: () => okAsync([]),
      findActiveByUserIdAndWord: () => okAsync(null),
      create: () => {
        throw new Error("not implemented");
      },
      updateStatus: () => {
        throw new Error("not implemented");
      },
    };

    const mockTemplateRepo: TemplateRepositoryPort = {
      findById: (id) => {
        if (id === 1) return okAsync(mockTemplate);
        return okAsync(null);
      },
      findDefault: () => okAsync(mockTemplate),
      create: () => {
        throw new Error("not implemented");
      },
    };

    const mockNotification: ChatNotificationPort = {
      editMessage: () => okAsync(undefined),
      sendFile: () => okAsync(undefined),
    };

    const result = await handleExportCommand(input, {
      cardRepo: mockCardRepo,
      templateRepo: mockTemplateRepo,
      chatNotification: mockNotification,
    });

    result.match(
      () => {
        throw new Error("Expected error");
      },
      (err) => {
        assertEquals(err.kind, "repository");
        assertEquals(err.message, "Update failed");
      },
    );
  });
});
