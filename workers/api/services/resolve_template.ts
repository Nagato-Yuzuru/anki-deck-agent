import type { ResultAsync } from "neverthrow";
import type { CardTemplate } from "../../shared/domain/mod.ts";
import type { RepositoryError } from "../../shared/domain/errors.ts";
import type { TemplateRepositoryPort } from "../../shared/ports/template_repository.ts";
import type { UserRepositoryPort } from "../../shared/ports/user_repository.ts";

export function resolveTemplate(
  userRepo: UserRepositoryPort,
  templateRepo: TemplateRepositoryPort,
  telegramId: number,
): ResultAsync<CardTemplate | null, RepositoryError> {
  return userRepo.findByTelegramId(telegramId).andThen((user) => {
    const templateId = user?.activeTemplateId ?? null;
    if (templateId !== null) {
      return templateRepo.findById(templateId);
    }
    return templateRepo.findDefault();
  });
}
