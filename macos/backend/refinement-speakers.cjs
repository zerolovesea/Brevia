const { normalized } = require('./worker-speakers.cjs');
function speakerFor(start, end, turns) {
  let overlap = 0,
    speaker = null;
  for (const turn of turns) {
    const amount = Math.min(end, turn.end_ms) - Math.max(start, turn.start_ms);
    if (amount > overlap || (amount === overlap && turn.speaker > speaker)) {
      overlap = amount;
      speaker = turn.speaker;
    }
  }
  return overlap > 0 ? speaker : null;
}
function stabilize(turns, minimum = 1000, gap = 600, absorb = 200) {
  const merge = (items) => {
    const merged = [];
    for (const turn of items) {
      const previous = merged.at(-1);
      if (previous && previous.speaker === turn.speaker && turn.start_ms <= previous.end_ms + gap)
        previous.end_ms = Math.max(previous.end_ms, turn.end_ms);
      else merged.push({ ...turn });
    }
    return merged;
  };
  let stable = merge(
    turns
      .filter((t) => t.end_ms > t.start_ms)
      .toSorted((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms),
  );
  while (stable.length > 1) {
    const candidates = [];
    for (let i = 0; i < stable.length; i++) {
      const turn = stable[i];
      if (turn.end_ms - turn.start_ms >= minimum) continue;
      for (const j of [i - 1, i + 1])
        if (stable[j]) {
          const other = stable[j];
          candidates.push([
            Math.max(0, j < i ? turn.start_ms - other.end_ms : other.start_ms - turn.end_ms),
            -(other.end_ms - other.start_ms),
            i,
            j,
          ]);
        }
    }
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    if (!candidates.length || candidates[0][0] > absorb) break;
    const [, , i, j] = candidates[0],
      other = stable[j],
      turn = stable[i];
    other.start_ms = Math.min(other.start_ms, turn.start_ms);
    other.end_ms = Math.max(other.end_ms, turn.end_ms);
    stable.splice(i, 1);
    stable = merge(stable);
  }
  return stable;
}
function deoverlap(turns, maximum = Infinity) {
  const result = [];
  let active = [];
  for (const turn of turns.toSorted((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)) {
    active = active.filter((t) => t.end_ms > turn.start_ms);
    const current = { ...turn };
    let dropped = false;
    for (const previous of active) {
      if (previous.speaker === current.speaker || current.start_ms >= previous.end_ms) continue;
      const overlap = Math.min(current.end_ms, previous.end_ms) - current.start_ms;
      if (overlap > maximum) continue;
      if (current.end_ms <= previous.end_ms) {
        dropped = true;
        break;
      }
      const boundary = Math.floor((current.start_ms + previous.end_ms) / 2);
      previous.end_ms = Math.max(previous.start_ms + 1, boundary);
      current.start_ms = Math.max(current.start_ms, Math.min(boundary, current.end_ms - 1));
    }
    if (!dropped) {
      result.push(current);
      active.push(current);
    }
  }
  return result.filter((t) => t.end_ms > t.start_ms);
}
function refinementTurns(turns, duration, maximum, gap = 0) {
  const merged = [];
  for (const turn of turns) {
    const previous = merged.at(-1),
      distance = previous ? turn.start_ms - previous.end_ms : Infinity;
    if (
      previous &&
      previous.speaker === turn.speaker &&
      distance >= 0 &&
      distance <= gap &&
      !turn._quiet &&
      !previous._quiet
    )
      previous.end_ms = Math.max(previous.end_ms, turn.end_ms);
    else merged.push({ ...turn });
  }
  return merged.flatMap((t) => {
    const start = Math.max(0, t.start_ms),
      end = Math.min(duration, t.end_ms),
      n = Math.ceil((end - start) / maximum);
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({
      start_ms: start + Math.floor(((end - start) * i) / n),
      end_ms: start + Math.floor(((end - start) * (i + 1)) / n),
      speaker: t.speaker,
      _quiet: !!t._quiet,
    }));
  });
}
function decodeRange(turn, before, after, duration, context = 800) {
  if (turn._quiet) context = 0;
  let start = Math.max(0, turn.start_ms - context),
    end = Math.min(duration, turn.end_ms + context);
  const separated = (other) => other.speaker !== turn.speaker || other._quiet || turn._quiet;
  if (before && separated(before)) start = Math.max(start, Math.min(turn.start_ms, before.end_ms));
  if (after && separated(after)) end = Math.min(end, Math.max(turn.end_ms, after.start_ms));
  return [start, end];
}
function autoCluster(embeddings, durations, count, config) {
  if (!embeddings.length) return [];
  const vectors = embeddings.map(normalized),
    dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0),
    argmax = (v) => v.indexOf(Math.max(...v));
  function cluster(n) {
    const centers = [vectors[argmax(durations)].slice()];
    for (let i = 1; i < n; i++) {
      const scores = vectors.map((v) => Math.max(...centers.map((c) => dot(v, c))));
      centers.push(vectors[scores.indexOf(Math.min(...scores))].slice());
    }
    let labels = null;
    for (let i = 0; i < 50; i++) {
      const updated = vectors.map((v) => argmax(centers.map((c) => dot(v, c))));
      if (labels && labels.every((n, j) => n === updated[j])) break;
      labels = updated;
      for (let label = 0; label < n; label++) {
        const members = labels.map((n, j) => (n === label ? j : -1)).filter((j) => j >= 0);
        if (members.length) {
          const center = vectors[0].map((_, j) =>
            members.reduce((n, index) => n + vectors[index][j] * durations[index], 0),
          );
          centers[label] = normalized(center);
        }
      }
    }
    return labels;
  }
  if (count > 0) return cluster(Math.min(count, vectors.length));
  if (vectors.length < 3) return vectors.map(() => 0);
  const candidates = new Map();
  for (let n = 1; n <= Math.min(config.max_auto_speakers, vectors.length - 1); n++) {
    const labels = cluster(n),
      unique = new Set(labels);
    if (
      unique.size === n &&
      [...unique].every((label) => {
        const members = labels.map((l, i) => (l === label ? i : -1)).filter((i) => i >= 0);
        return (
          members.length >= config.min_auto_speaker_windows &&
          members.reduce((sum, i) => sum + durations[i], 0) >= config.min_auto_speaker_duration_ms
        );
      })
    )
      candidates.set(n, labels);
  }
  if (!candidates.size) return vectors.map(() => 0);
  const scores = new Map([...candidates.keys()].map((n) => [n, 0]));
  for (let i = 0; i < vectors.length; i++) {
    const distances = vectors.map((v) => 1 - Math.max(-1, Math.min(1, dot(vectors[i], v))));
    for (const [n, labels] of candidates) {
      if (n === 1) continue;
      const sums = Array(n).fill(0),
        weights = Array(n).fill(0);
      for (let j = 0; j < vectors.length; j++)
        if (i !== j) {
          sums[labels[j]] += distances[j] * durations[j];
          weights[labels[j]] += durations[j];
        }
      const own = labels[i];
      if (!weights[own]) continue;
      const within = sums[own] / weights[own],
        nearest = Math.min(...sums.map((sum, k) => (k !== own ? sum / weights[k] : Infinity)));
      scores.set(
        n,
        scores.get(n) + ((nearest - within) / Math.max(nearest, within, 1e-9)) * durations[i],
      );
    }
  }
  const weight = durations.reduce((a, b) => a + b, 0);
  for (const [n, score] of scores) scores.set(n, score / weight);
  const best = Math.max(...scores.values()),
    selected = Math.max(
      ...[...scores]
        .filter(([, score]) => score >= best - config.auto_cluster_score_tolerance)
        .map(([n]) => n),
    );
  return candidates.get(selected);
}
module.exports = { speakerFor, stabilize, deoverlap, refinementTurns, decodeRange, autoCluster };
