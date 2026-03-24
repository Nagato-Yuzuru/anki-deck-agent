import type { Card } from "./card.ts";

export type ReadyCard = Card & { readonly templateId: number };
