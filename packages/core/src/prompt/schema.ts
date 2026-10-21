/** Kinds of change the model may report (SPEC §5.4); they feed the review badges and §5.7. */
export const CHANGE_KINDS = ['ortografia', 'pontuacao', 'glossario', 'nome_proprio', 'concordancia', 'outro'] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One block the model changed. Blocks it leaves out keep their text. */
export interface ModelChange {
  index: number;
  text: string;
  kind: ChangeKind;
  note?: string;
}

export interface ModelResponse {
  changes: ModelChange[];
}

/** JSON Schema passed to `claude -p --json-schema` (SPEC §5.4). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          text: { type: 'string' },
          kind: { type: 'string', enum: [...CHANGE_KINDS] },
          note: { type: 'string' },
        },
        required: ['index', 'text', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['changes'],
  additionalProperties: false,
} as const;
