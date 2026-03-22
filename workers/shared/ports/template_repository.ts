import type { ResultAsync } from "neverthrow";
import type { CardTemplate } from "../domain/card_template.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface TemplateRepositoryPort {
  findById(id: number): ResultAsync<CardTemplate | null, RepositoryError>;
}
