const { z } = require('zod');
const text = z.string().max(200000);
const source = z.object({
  text,
  speaker: z.string().max(500),
  speaker_id: z.string().max(500).optional(),
  start_ms: z.number().finite().nonnegative(),
});
const snapshotSchema = z
  .object({
    title: z.string().min(1).max(1000),
    language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']),
    meeting_date: z.string().max(100).optional(),
    duration_ms: z.number().finite().nonnegative().optional(),
    markdown: z.string().max(1000000),
    transcript: z.array(source.extend({ translation: text.optional() })).max(20000),
    claims: z
      .array(
        z.object({
          id: z.string().max(200),
          text,
          section: z.string().max(1000),
          status: z.enum(['missing', 'changed', 'thin', 'supported']).optional(),
          sources: z.array(source).max(500),
        }),
      )
      .max(1000),
  })
  .refine((value) => value.markdown.trim() || value.transcript.length || value.claims.length);
const uploadSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  days: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30)]),
  snapshot: snapshotSchema,
});
const MAX_BYTES = 4 * 1024 * 1024;
module.exports = { snapshotSchema, uploadSchema, MAX_BYTES };
