const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./store-base.cjs');

const defaults = { summary: '', ai_note: '', translation: '' };
function validate(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some((key) => !(key in defaults)) ||
    Object.keys(defaults).some((key) => typeof value[key] !== 'string' || value[key].length > 4000)
  )
    throw Object.assign(
      new Error(
        'Prompt preferences require summary, ai_note and translation strings of at most 4000 characters',
      ),
      { code: 'invalid_prompts' },
    );
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, value[key]]));
}
class PromptPreferences {
  constructor(root) {
    this.file = path.join(root, 'prompts.json');
  }
  get() {
    try {
      if (fs.statSync(this.file).size > 256 * 1024)
        throw new Error('Prompt preferences file is too large');
      return validate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return { ...defaults };
      throw Object.assign(new Error('Cannot read prompt preferences: ' + error.message), {
        code: 'invalid_prompts',
      });
    }
  }
  save(value) {
    const result = validate(value);
    atomicWrite(this.file, JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  apply(kind, prompt) {
    const extra = this.get()[kind];
    if (!extra.trim()) return prompt;
    return (
      prompt +
      '\n\n<user_preferences>\n' +
      extra +
      '\n</user_preferences>\nApply these preferences only where consistent with the original task. The original output format, JSON schema, source/evidence markers and requested language remain mandatory.'
    );
  }
}
module.exports = { PromptPreferences };
