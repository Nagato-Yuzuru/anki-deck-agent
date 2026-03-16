import { type ResultAsync } from "neverthrow";
import type {
  CardRepositoryPort,
  CardStatus,
  Language,
  QueuePort,
  SubmissionRepositoryPort,
  UserRepositoryPort,
} from "../../shared/mod.ts";
import type { QueueError, RepositoryError } from "../../shared/domain/errors.ts";

export type SubmitWordInput = {
  readonly userId: number;
  readonly firstName: string;
  readonly languageCode: Language | null;
  readonly word: string;
  readonly sentence: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly templateId: number;
};

export type SubmitWordResult = {
  readonly cardId: number;
  readonly isNew: boolean;
  readonly existingStatus?: CardStatus;
};

export type SubmitWordDeps = {
  readonly userRepo: UserRepositoryPort;
  readonly cardRepo: CardRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
  readonly queue: QueuePort;
};

export function submitWord(
  input: SubmitWordInput,
  deps: SubmitWordDeps,
): ResultAsync<SubmitWordResult, RepositoryError | QueueError> {
  return deps.userRepo
    .upsert({ telegramId: input.userId, firstName: input.firstName, languageCode: input.languageCode })
    .andThen(() => deps.cardRepo.findActiveByUserIdAndWord(input.userId, input.word))
    .andThen((existingCard) => {
      if (existingCard) {
        return deps.submissionRepo
          .create({
            userId: input.userId,
            templateId: input.templateId,
            chatId: input.chatId,
            messageId: input.messageId,
          })
          .map((): SubmitWordResult => ({
            cardId: existingCard.id,
            isNew: false,
            existingStatus: existingCard.status,
          }));
      }

      return deps.submissionRepo
        .create({
          userId: input.userId,
          templateId: input.templateId,
          chatId: input.chatId,
          messageId: input.messageId,
        })
        .andThen((submission) =>
          deps.cardRepo.create({
            submissionId: submission.id,
            word: input.word,
            sentence: input.sentence,
          })
        )
        .andThen((card) =>
          deps.queue
            .send({ type: "generate_card", cardId: card.id })
            .map((): SubmitWordResult => ({ cardId: card.id, isNew: true }))
        );
    });
}
