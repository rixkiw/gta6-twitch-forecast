import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
export const DEFAULT_CONFIG = Object.freeze({ bandwidth: 1.5, context: true, metadata: true });
const HOUR = 3600000;
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const identity = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null;
};

/** Parse only unlock/platform descriptions, never research notes containing outcome summaries. */
export function metadata(unlock = '', platforms = '') {
  const text = String(unlock).split(/Source:|Tier:|Research note:/i)[0].toLowerCase();
  const platform = String(platforms).toLowerCase().split(/[([]/)[0];
  const pc = /\bpc\b|stadia/.test(platform);
  const console = /ps[345]|playstation|xbox|switch/.test(platform);
  const early = /early access|early-access|premium|deluxe/.test(text) && !/no early access/.test(text);
  const rolling = /midnight local|local midnight|rolling|east coast midnight/.test(text);
  return [console && !pc ? 1 : 0, rolling ? 1 : 0, early ? 1 : 0];
}

/** Aggregate duplicate observations by UTC hour; unsampled hours remain absent. */
export function hourlyRows(rows = [], cutoff = Infinity) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const stamp = Date.parse(row.from ?? row.at);
    if (!Number.isFinite(stamp) || stamp + HOUR > cutoff || typeof row.viewers !== 'number' || !Number.isFinite(row.viewers) || row.viewers < 0) continue;
    const hour = Math.floor(stamp / HOUR) * HOUR;
    const group = groups.get(hour) ?? { viewers: 0, channels: 0, weight: 0, channelWeight: 0 };
    const weight = positive(row.reads) ? Math.min(row.reads, 60) : 1;
    group.viewers += weight * Math.max(1, row.viewers);
    group.weight += weight;
    if (positive(row.channels)) {
      group.channels += weight * row.channels;
      group.channelWeight += weight;
    }
    groups.set(hour, group);
  }
  return new Map([...groups].map(([stamp, row]) => [stamp, {
    viewers: row.viewers / row.weight,
    channels: row.channelWeight ? row.channels / row.channelWeight : null
  }]));
}

function features(anchor, channels, past, start, meta) {
  const recent = [...past].filter(([stamp]) => stamp >= start - 12 * HOUR && stamp < start).map(([, row]) => row.viewers);
  const trend = recent.length >= 3 ? clamp(Math.log(anchor / median(recent)), -4, 4) / 2 : null;
  const audience = positive(channels) ? clamp(Math.log(anchor / channels), 0, 10) / 2 : null;
  return [Math.log(anchor) / 2, trend, audience, ...meta];
}

/** Only launch-day outcomes of supplied non-target comparables enter training. */
export function trainingRecords(input) {
  const target = identity(input.game?.name ?? input.name);
  const targetId = input.game?.twitch_id;
  const records = [];
  const seen = new Set();
  for (const comp of Array.isArray(input.comparables) ? input.comparables : []) {
    const marker = `${comp.unlock ?? ''} ${comp.source ?? ''} ${comp.name ?? ''} ${comp.tier ?? ''}`;
    if (/target-history|not a launch/i.test(marker)) continue;
    if (target && identity(comp.name) === target) continue;
    if (targetId != null && [comp.twitch_id, comp.game?.twitch_id].some(value => value != null && String(value) === String(targetId))) continue;
    const start = Date.parse(comp.day_start);
    const key = `${identity(comp.name)}:${start}`;
    if (!Number.isFinite(start) || seen.has(key)) continue;
    const rows = hourlyRows(comp.hourly);
    const anchor = rows.get(start);
    if (!anchor) continue;
    seen.add(key);
    const meta = metadata(comp.unlock, comp.platforms);
    records.push({ name: comp.name, start, anchor: anchor.viewers, meta,
      x: features(anchor.viewers, anchor.channels, hourlyRows(comp.hourly, start + HOUR), start, meta),
      outcomes: Array.from({ length: 24 }, (_, index) => {
        const row = rows.get(start + index * HOUR);
        return row ? clamp(Math.log(row.viewers / anchor.viewers), -12, 12) : null;
      }) });
  }
  return records;
}

function targetFeatures(input) {
  const start = Date.parse(input.day_start);
  const checkpoint = Math.min(Date.parse(input.checkpoint), start + HOUR);
  const known = (Array.isArray(input.known) ? input.known : []).find(row => row.hour === 1 &&
    (!row.from || Date.parse(row.from) === start) && (!row.until || Date.parse(row.until) <= checkpoint));
  const anchor = positive(known?.viewers) ? clamp(known.viewers, 1, 1e9) : 1;
  const rows = hourlyRows(Array.isArray(input.history_hourly) && input.history_hourly.length ? input.history_hourly : input.history, checkpoint);
  const meta = metadata(input.unlock ?? input.notes, input.platforms ?? input.game?.platforms ?? input.notes?.split(';')[0]);
  return { anchor, x: features(anchor, known?.channels, rows, start, meta), meta };
}

function difference(left, right, config) {
  return left.map((value, index) => {
    if ((!config.context && (index === 1 || index === 2)) || (!config.metadata && index >= 3)) return 0;
    return value == null || right[index] == null ? 0 : clamp(value - right[index], -4, 4);
  });
}

function similarity(delta, config) {
  const distance = delta.reduce((sum, value, index) => sum + value * value * (index >= 3 ? 1.5 : index === 0 ? 1 : 0.35), 0);
  return 0.05 + 0.95 * Math.exp(-distance / (2 * config.bandwidth ** 2));
}

function solve(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let index = column + 1; index < size; index++) if (Math.abs(rows[index][column]) > Math.abs(rows[pivot][column])) pivot = index;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-12) return Array(size).fill(0);
    for (let index = column; index <= size; index++) rows[column][index] /= divisor;
    for (let index = 0; index < size; index++) {
      if (index === column) continue;
      const factor = rows[index][column];
      for (let entry = column; entry <= size; entry++) rows[index][entry] -= factor * rows[column][entry];
    }
  }
  return rows.map(row => row[size]);
}

/** Ridge local-linear log ratios with Huber reweighting and a weak persistence intercept prior. */
function location(records, target, hour, config) {
  const samples = records.filter(record => record.outcomes[hour] != null).map(record => {
    const delta = difference(record.x, target.x, config);
    return { design: [1, ...delta], weight: similarity(delta, config), outcome: record.outcomes[hour] };
  });
  if (!samples.length) return 0;
  let coefficients = Array(7).fill(0);
  for (let iteration = 0; iteration < 3; iteration++) {
    const matrix = Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, column) => row === column ? (row === 0 ? 0.5 : 4) : 0));
    const vector = Array(7).fill(0);
    for (const sample of samples) {
      const residual = sample.outcome - sample.design.reduce((sum, value, index) => sum + value * coefficients[index], 0);
      const weight = sample.weight * (iteration ? Math.min(1, 1.5 / Math.max(0.001, Math.abs(residual))) : 1);
      for (let row = 0; row < 7; row++) {
        vector[row] += weight * sample.design[row] * sample.outcome;
        for (let column = 0; column < 7; column++) matrix[row][column] += weight * sample.design[row] * sample.design[column];
      }
    }
    coefficients = solve(matrix, vector);
  }
  return clamp(coefficients[0], -8, 8);
}

function normalCDF(value) {
  const magnitude = Math.abs(value);
  const scale = 1 / (1 + 0.2316419 * magnitude);
  const tail = Math.exp(-magnitude * magnitude / 2) / Math.sqrt(2 * Math.PI) * scale *
    (0.319381530 + scale * (-0.356563782 + scale * (1.781477937 + scale * (-1.821255978 + scale * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

/** Cross-fitted predictive residual mixture; normal pseudo-observations stabilize small samples. */
export function forecast(input, config = DEFAULT_CONFIG) {
  const records = trainingRecords(input);
  const target = targetFeatures(input);
  const residuals = records.map((record, index) => {
    const others = records.filter((_, other) => other !== index);
    return record.outcomes.map((outcome, hour) => outcome == null ? null : outcome - location(others, record, hour, config));
  });
  return { hours: Array.from({ length: 23 }, (_, index) => {
    const hour = index + 1;
    const center = location(records, target, hour, config);
    const samples = records.flatMap((record, recordIndex) => residuals[recordIndex][hour] == null ? [] : [{
      value: residuals[recordIndex][hour], weight: similarity(difference(record.x, target.x, config), config)
    }]);
    const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
    const squared = samples.reduce((sum, sample) => sum + sample.weight ** 2, 0);
    const effective = squared ? total ** 2 / squared : 0;
    const prior = 4;
    const priorScale = Math.max(0.2, 0.15 * Math.sqrt(hour));
    const kernel = 0.1 + 0.12 * Math.sqrt(hour / 23) + 0.3 / Math.sqrt(Math.max(1, effective));
    const quantiles = LEVELS.map(level => {
      let lower = -20;
      let upper = 20;
      for (let iteration = 0; iteration < 48; iteration++) {
        const value = (lower + upper) / 2;
        const mass = samples.reduce((sum, sample) => sum + sample.weight * normalCDF((value - sample.value) / kernel), 0) + prior * normalCDF((value + center) / priorScale);
        if (mass / (total + prior) < level) lower = value;
        else upper = value;
      }
      return clamp(Math.exp(Math.log(target.anchor) + center + (lower + upper) / 2), 1e-6, 1e9);
    });
    return { hour: hour + 1, q: quantiles };
  }) };
}

export function persistence(anchor) {
  return { hours: Array.from({ length: 23 }, (_, index) => ({ hour: index + 2,
    q: Z.map(value => clamp(Math.max(1, anchor) * Math.exp(value * 0.15 * Math.sqrt(index + 1)), 1e-6, 1e9)) })) };
}

export function run(inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input', outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output') {
  const files = fs.readdirSync(inputDir).filter(name => name.endsWith('.in')).sort();
  if (!files.length) return;
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of files) {
    const input = JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf8'));
    fs.writeFileSync(path.join(outputDir, `${path.basename(file, '.in')}.out`), JSON.stringify(forecast(input)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run();
