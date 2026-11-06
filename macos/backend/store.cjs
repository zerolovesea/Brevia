const { StoreBase } = require('./store-base.cjs');
const meetings = require('./store-meetings.cjs');
const transcripts = require('./store-transcripts.cjs');
const corrections = require('./store-corrections.cjs');
const speakers = require('./store-speakers.cjs');
const audio = require('./store-audio.cjs');
const maintenance = require('./store-maintenance.cjs');
const workspaces = require('./store-workspaces.cjs');
class Store extends StoreBase {}
Object.assign(
  Store.prototype,
  meetings,
  transcripts,
  corrections,
  speakers,
  audio,
  maintenance,
  workspaces,
);
module.exports = { Store };
