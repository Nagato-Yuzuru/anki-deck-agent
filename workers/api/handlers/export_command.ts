import { errAsync, fromPromise, type ResultAsync } from "neverthrow";
import type { CardRepositoryPort } from "../../shared/ports/card_repository.ts";
import type { TemplateRepositoryPort } from "../../shared/ports/template_repository.ts";
import type { ChatNotificationPort } from "../../shared/ports/chat_notification.ts";
import type { ExportError, NotificationError, RepositoryError } from "../../shared/domain/errors.ts";
import { exportCards } from "../../shared/services/export_cards.ts";
import type { ReadyCard } from "../../shared/domain/mod.ts";

export type ExportCommandInput = {
  readonly userId: number;
  readonly chatId: string;
};

export type ExportCommandDeps = {
  readonly cardRepo: CardRepositoryPort;
  readonly templateRepo: TemplateRepositoryPort;
  readonly chatNotification: ChatNotificationPort;
};

type ExportCommandError = RepositoryError | NotificationError | ExportError;

type GroupResult = { tsv: string; cardIds: number[] };

async function processGroupEntry(
  templateId: number,
  cards: ReadyCard[],
  templateRepo: TemplateRepositoryPort,
): Promise<GroupResult | null> {
  const templateResult = await templateRepo.findById(templateId);

  if (templateResult.isErr()) {
    throw templateResult.error;
  }

  const template = templateResult.value;
  if (template === null) {
    // Skip this group — template no longer exists
    console.warn({ event: "export_template_not_found", templateId });
    return null;
  }

  const exportResult = exportCards({ cards, template });
  if (exportResult.isErr()) {
    throw exportResult.error;
  }

  return {
    tsv: exportResult.value.tsv,
    cardIds: Array.from(exportResult.value.cardIds),
  };
}

async function processGroupsAsync(
  cardsByTemplate: Map<number, ReadyCard[]>,
  templateRepo: TemplateRepositoryPort,
): Promise<GroupResult[]> {
  const entries = Array.from(cardsByTemplate.entries());
  const settled = await Promise.all(
    entries.map(([templateId, cards]) => processGroupEntry(templateId, cards, templateRepo)),
  );
  return settled.filter((r): r is GroupResult => r !== null);
}

export function handleExportCommand(
  input: ExportCommandInput,
  deps: ExportCommandDeps,
): ResultAsync<void, ExportCommandError> {
  return deps.cardRepo
    .findReadyByUserId(input.userId)
    .mapErr((e): ExportCommandError => e)
    .andThen((readyCards) => {
      if (readyCards.length === 0) {
        return errAsync<void, ExportCommandError>({
          kind: "export",
          message: "No cards ready for export",
        });
      }

      // Group cards by templateId
      const cardsByTemplate = new Map<number, ReadyCard[]>();
      for (const card of readyCards) {
        const group = cardsByTemplate.get(card.templateId) ?? [];
        group.push(card);
        cardsByTemplate.set(card.templateId, group);
      }

      // Process all template groups concurrently
      const groupsResult: ResultAsync<GroupResult[], ExportCommandError> = fromPromise(
        processGroupsAsync(cardsByTemplate, deps.templateRepo),
        (thrown): ExportCommandError => thrown as ExportCommandError,
      );

      return groupsResult.andThen((groups) => {
        if (groups.length === 0) {
          return errAsync<void, ExportCommandError>({
            kind: "export",
            message: "No valid cards to export",
          });
        }

        const tsvParts = groups.map((g) => g.tsv);
        const allCardIds = groups.flatMap((g) => g.cardIds);
        const combinedTsv = tsvParts.join("\n");
        const fileBytes = new TextEncoder().encode(combinedTsv);

        return deps.chatNotification
          .sendFile(input.chatId, fileBytes, "anki_export.txt")
          .mapErr((e): ExportCommandError => e)
          .andThen(() =>
            deps.cardRepo
              .markExported(allCardIds)
              .mapErr((e): ExportCommandError => e)
          );
      });
    });
}
