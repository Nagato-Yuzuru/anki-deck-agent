import { errAsync, type ResultAsync } from "neverthrow";
import type {
  CardRepositoryPort,
  LlmPort,
  SubmissionRepositoryPort,
  TemplateRepositoryPort,
} from "../../shared/mod.ts";
import type { RepositoryError } from "../../shared/domain/errors.ts";
import { CARD_STATUS } from "../../shared/mod.ts";

export type GenerateCardResult = {
  readonly word: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly succeeded: boolean;
  readonly errorMessage?: string;
};

export type GenerateCardDeps = {
  readonly cardRepo: CardRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
  readonly templateRepo: TemplateRepositoryPort;
  readonly llm: LlmPort;
};

export function generateCard(
  cardId: number,
  deps: GenerateCardDeps,
): ResultAsync<GenerateCardResult, RepositoryError> {
  return deps.cardRepo
    .findById(cardId)
    .andThen((card) => {
      if (!card) {
        return errAsync<never, RepositoryError>({
          kind: "repository",
          message: `Card not found: ${cardId}`,
        });
      }

      return deps.cardRepo
        .updateStatus(card.id, CARD_STATUS.GENERATING)
        .andThen(() => deps.submissionRepo.findById(card.submissionId))
        .andThen((submission) => {
          if (!submission) {
            return deps.cardRepo
              .updateStatus(card.id, CARD_STATUS.FAILED, {
                errorMessage: `Submission not found: ${card.submissionId}`,
              })
              .andThen(() =>
                errAsync<never, RepositoryError>({
                  kind: "repository",
                  message: `Submission not found: ${card.submissionId}`,
                })
              );
          }

          return deps.templateRepo.findById(submission.templateId).andThen(
            (template) => {
              if (!template) {
                const errorMessage = `Template not found: ${submission.templateId}`;
                return deps.cardRepo
                  .updateStatus(card.id, CARD_STATUS.FAILED, {
                    errorMessage,
                  })
                  .map((): GenerateCardResult => ({
                    word: card.word,
                    chatId: submission.chatId,
                    messageId: submission.messageId,
                    succeeded: false,
                    errorMessage,
                  }));
              }

              const prompt = template.promptTemplate
                .replaceAll("{word}", card.word)
                .replaceAll("{sentence}", card.sentence);

              return deps.llm
                .generateStructured(prompt, template.responseJsonSchema)
                .map((llmResponse) => JSON.stringify(llmResponse))
                .andThen((llmResponseJson) =>
                  deps.cardRepo
                    .updateStatus(card.id, CARD_STATUS.READY, { llmResponseJson })
                    .map((): GenerateCardResult => ({
                      word: card.word,
                      chatId: submission.chatId,
                      messageId: submission.messageId,
                      succeeded: true,
                    }))
                )
                .orElse((llmErr) =>
                  deps.cardRepo
                    .updateStatus(card.id, CARD_STATUS.FAILED, {
                      errorMessage: llmErr.message,
                    })
                    .mapErr((repoErr) => {
                      console.error({
                        event: "card_status_update_failed",
                        cardId: card.id,
                        targetStatus: "failed",
                        error: repoErr.message,
                      });
                      return repoErr;
                    })
                    .map((): GenerateCardResult => ({
                      word: card.word,
                      chatId: submission.chatId,
                      messageId: submission.messageId,
                      succeeded: false,
                      errorMessage: llmErr.message,
                    }))
                );
            },
          );
        });
    });
}
