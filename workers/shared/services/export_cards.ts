import { err, ok, type Result } from "neverthrow";
import type { Card, CardTemplate } from "../domain/mod.ts";
import type { ExportError } from "../domain/errors.ts";

export type ExportCardsInput = {
  readonly cards: readonly Card[];
  readonly template: CardTemplate;
};

export type ExportCardsResult = {
  readonly tsv: string;
  readonly cardIds: readonly number[];
};

function sanitize(value: string): string {
  return value.replace(/[\t\r\n]/g, " ");
}

export function exportCards(input: ExportCardsInput): Result<ExportCardsResult, ExportError> {
  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(input.template.ankiFieldsMapping) as Record<string, string>;
  } catch {
    return err({ kind: "export", message: `Invalid ankiFieldsMapping JSON in template "${input.template.name}"` });
  }
  const fieldKeys = Object.values(mapping);

  const rows: string[] = [];
  const cardIds: number[] = [];

  for (const card of input.cards) {
    if (card.llmResponseJson === null) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(card.llmResponseJson) as Record<string, unknown>;
    } catch {
      continue;
    }

    const fields = fieldKeys.map((key) => sanitize(String(parsed[key] ?? "")));
    rows.push(fields.join("\t"));
    cardIds.push(card.id);
  }

  if (rows.length === 0) {
    return err({ kind: "export", message: "No valid cards to export" });
  }

  return ok({ tsv: rows.join("\n"), cardIds });
}
