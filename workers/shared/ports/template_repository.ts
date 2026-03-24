import type { ResultAsync } from "neverthrow";
import type { CardTemplate, NewCardTemplate } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface TemplateRepositoryPort {
  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError>;
  findDefault(): ResultAsync<CardTemplate | null, RepositoryError>;
  create(template: NewCardTemplate): ResultAsync<CardTemplate, RepositoryError>;
}
