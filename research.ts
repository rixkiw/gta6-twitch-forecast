import { trainingRecords, hourlyRows, targetMetadata, persistence, LEVELS } from './main.ts';

export const GRID = Object.freeze([
  { method: 'curve', mismatch: 0.08, bandwidth: 2 },
  { method: 'curve', mismatch: 0.2, bandwidth: 2 },
  { method: 'curve', mismatch: 0.08, bandwidth: 4 },
  { method: 'residual', mismatch: 0.08, bandwidth: 2 },
  { method: 'residual', mismatch: 0.2, bandwidth: 2 },
  { method: 'residual', mismatch: 0.08, bandwidth: 4 }
]);
const HOUR = 3600000;
export const titleKey = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clamp = value => Math.max(1e-6, Math.min(1e9, value));

export function recordsFor(input, retrospective = false) {
  const start = Date.parse(input.day_start);
  return trainingRecords(input).filter(record => retrospective || !Number.isFinite(start) || record.start < start);
}

function weight(record, target, config) {
  return Math.exp(-(Math.log(record.anchor / target.anchor) ** 2) / (2 * config.bandwidth ** 2)) *
    (record.meta[0] === target.meta[0] ? 1 : config.mismatch) *
    (record.meta[1] === target.meta[1] ? 1 : 0.6) *
    (record.meta[2] === target.meta[2] ? 1 : 0.6);
}

export function weightedQuantile(samples, level) {
  const sorted = samples.filter(sample => sample.weight > 0).sort((left, right) => left.value - right.value);
  if (!sorted.length) return 0;
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  let cumulative = 0;
  let previous = null;
  for (const sample of sorted) {
    const position = (cumulative + sample.weight / 2) / total;
    if (position >= level) {
      if (!previous) return sample.value;
      const fraction = (level - previous.position) / (position - previous.position);
      return previous.value + fraction * (sample.value - previous.value);
    }
    previous = { position, value: sample.value };
    cumulative += sample.weight;
  }
  return sorted.at(-1).value;
}

function location(records, target, hour, config) {
  const samples = records.filter(record => record.outcomes[hour] != null).map(record => ({
    value: record.outcomes[hour], weight: weight(record, target, config)
  }));
  samples.push({ value: 0, weight: 0.5 });
  let center = weightedQuantile(samples, 0.5);
  for (let iteration = 0; iteration < 12; iteration++) {
    let numerator = 0;
    let denominator = 0;
    for (const sample of samples) {
      const effective = sample.weight * Math.min(1, 0.7 / Math.max(1e-9, Math.abs(sample.value - center)));
      numerator += effective * sample.value;
      denominator += effective;
    }
    center = numerator / denominator;
  }
  return center;
}

export function forecastCandidate(input, config) {
  const records = recordsFor(input, config.retrospective === true);
  const start = Date.parse(input.day_start);
  const checkpoint = Math.min(Date.parse(input.checkpoint), start + HOUR);
  const known = (Array.isArray(input.known) ? input.known : []).find(row => row.hour === 1 &&
    (!row.from || Date.parse(row.from) === start) && (!row.until || Date.parse(row.until) <= checkpoint));
  const target = { anchor: typeof known?.viewers === 'number' && Number.isFinite(known.viewers) ? Math.max(1, Math.min(1e9, known.viewers)) : 1,
    meta: targetMetadata(input) };
  if (!records.length) return persistence(target.anchor);
  const calibration = config.method === 'residual' ? records.flatMap(record => {
    const prior = records.filter(other => other.start < record.start && titleKey(other.name) !== titleKey(record.name));
    if (prior.length < 4) return [];
    return [{ record, residuals: record.outcomes.map((outcome, hour) => outcome == null ? null : outcome - location(prior, record, hour, config)) }];
  }) : [];
  return { hours: Array.from({ length: 23 }, (_, index) => {
    const hour = index + 1;
    let samples = [];
    for (const item of calibration) {
      const values = item.residuals.slice(Math.max(1, hour - 2), Math.min(24, hour + 3)).filter(value => value != null);
      for (const value of values) samples.push({ value, weight: weight(item.record, target, config) / values.length });
    }
    const calibrated = calibration.length >= 4 && samples.length > 0;
    if (!calibrated) samples = records.filter(record => record.outcomes[hour] != null).map(record => ({ value: record.outcomes[hour], weight: weight(record, target, config) }));
    const center = calibrated ? location(records, target, hour, config) : 0;
    const fallback = persistence(target.anchor).hours[index].q;
    return { hour: hour + 1, q: samples.length ? LEVELS.map(level => clamp(target.anchor * Math.exp(center + weightedQuantile(samples, level)))) : fallback };
  }) };
}

export function heldInput(comp, comparables, chronological) {
  const start = Date.parse(comp.day_start);
  const checkpoint = new Date(start + HOUR).toISOString();
  const rows = hourlyRows(comp.hourly, start + HOUR);
  const anchor = rows.get(start);
  const allowed = comparables.filter(other => titleKey(other.name) !== titleKey(comp.name) &&
    (!chronological || Date.parse(other.day_start) < start));
  return { day_start: comp.day_start, checkpoint, game: { name: comp.name, twitch_id: comp.twitch_id },
    unlock: comp.unlock, platforms: comp.platforms,
    known: anchor ? [{ hour: 1, from: comp.day_start, until: checkpoint, ...anchor }] : [],
    history_hourly: (comp.hourly ?? []).filter(row => Date.parse(row.from ?? row.at) + HOUR <= start + HOUR),
    comparables: allowed };
}
