const { z } = require('zod');
const path = require('node:path');
const absolute = z.string().min(1).max(4096).refine(path.isAbsolute, 'Use an absolute local path');
const language = z.string().min(2).max(32);
const task = z.object({ task_id: z.string().uuid() }).strict();
const schemas = {
  'app.status': z.object({}).strict(),
  'models.list': z.object({}).strict(),
  'devices.list': z.object({}).strict(),
  'meeting.search': z.object({ query: z.string().max(120) }).strict(),
  'meeting.get': z.object({ meeting_id: z.string().uuid() }).strict(),
  'speaker-profile.list': z.object({}).strict(),
  'task.get': task,
  'task.cancel': task,
  'inference.run': z
    .object({
      operation: z.enum(['transcribe', 'translate', 'diarize', 'voice-match']),
      input_path: absolute.optional(),
      text: z.string().min(1).max(1000000).optional(),
      language: language.default('auto'),
      target_language: language.optional(),
      model_id: z.string().min(1).max(128).optional(),
      profile_id: z.string().uuid().optional(),
      num_speakers: z
        .number()
        .int()
        .min(-1)
        .max(100)
        .refine((n) => n === -1 || n > 0)
        .optional(),
      output_path: absolute,
      format: z.enum(['txt', 'md', 'srt', 'vtt', 'json']).optional(),
    })
    .strict()
    .superRefine((p, ctx) => {
      if (Boolean(p.input_path) === Boolean(p.text))
        ctx.addIssue({ code: 'custom', message: 'Supply exactly one input_path or text' });
      if (p.operation === 'translate' && !p.target_language)
        ctx.addIssue({ code: 'custom', message: 'target_language is required' });
      if (p.operation !== 'translate' && !p.input_path)
        ctx.addIssue({ code: 'custom', message: 'This operation requires input_path' });
      if (p.operation === 'voice-match' && !p.profile_id)
        ctx.addIssue({ code: 'custom', message: 'profile_id is required' });
    }),
  'recording.control': z
    .object({
      action: z.enum(['start', 'pause', 'resume', 'stop']),
      target: z.string().min(1).max(128).default('computer'),
      request_id: z.string().min(1).max(128),
      meeting_id: z.string().uuid().optional(),
      title: z.string().min(1).max(120).optional(),
      language: language.optional(),
      refined_model_id: z.string().min(1).max(128).optional(),
      audio_tracks: z
        .array(z.enum(['mic', 'system']))
        .min(1)
        .max(2)
        .optional(),
      device_id: z.string().max(1024).optional(),
    })
    .strict(),
};
const scopeFor = (method) =>
  method === 'recording.control'
    ? 'record'
    : ['inference.run', 'task.cancel'].includes(method)
      ? 'infer'
      : 'read';
const failure = (code, message) => Object.assign(new Error(message), { code });
module.exports = { schemas, scopeFor, failure };
