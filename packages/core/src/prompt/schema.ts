import { z } from 'zod';

/** Kinds of change the model may report (SPEC §5.4); they feed the review badges and §5.7. */
export const CHANGE_KINDS = ['ortografia', 'pontuacao', 'glossario', 'nome_proprio', 'concordancia', 'outro'] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

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

/** The same contract as `RESPONSE_SCHEMA`, checked on our side: the CLI may not enforce it. */
export const ModelResponseSchema = z.strictObject({
  changes: z.array(
    z.strictObject({
      index: z.number().int(),
      text: z.string(),
      kind: z.enum(CHANGE_KINDS),
      note: z.string().optional(),
    }),
  ),
});

/** One block the model changed. Blocks it leaves out keep their text. */
export type ModelChange = z.infer<typeof ModelResponseSchema>['changes'][number];
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

/** `null` when `data` is a valid answer; otherwise the reason, for the log. */
export function checkModelResponse(data: unknown): string | null {
  const result = ModelResponseSchema.safeParse(data);
  if (result.success) return null;
  const issue = result.error.issues[0];
  return issue ? `${issue.path.join('.') || 'raiz'}: ${issue.message}` : 'formato inválido';
}
