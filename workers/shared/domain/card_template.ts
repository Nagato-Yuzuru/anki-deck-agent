export type CardTemplate = {
  readonly id: number;
  readonly name: string;
  readonly promptTemplate: string;
  readonly responseJsonSchema: string;
  readonly ankiNoteType: string;
  readonly ankiFieldsMapping: string;
  readonly isActive: boolean;
  readonly createdAt: string;
};
