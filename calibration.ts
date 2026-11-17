import { robustForecast, DEFAULT_CONFIG, targetMetadata, trainingRecords, LEVELS } from './main.ts';
import { heldInput, titleKey } from './research.ts';

export const WIDTH_GRID = Object.freeze([
  { group: 'console', scale: 1 },
  { group: 'console', scale: 0.45 },
  { group: 'console', scale: 0.65 },
  { group: 'console', scale: 0.85 },
  { group: 'all', scale: 0.65 },
  { group: 'all', scale: 0.85 }
]);

export function compress(output, meta, config) {
  const scale = config.group === 'all' || meta[0] ? config.scale : 1;
  if (scale === 1) return output;
  return { hours: output.hours.map(row => ({ hour: row.hour, q: row.q.map((value, index) =>
    index === 2 ? value : Math.exp(Math.log(row.q[2]) + scale * (Math.log(value) - Math.log(row.q[2])))) })) };
}

export function titleLoss(output, record) {
  const losses = output.hours.flatMap(row => {
    const outcome = record.outcomes[row.hour - 1];
    if (outcome == null) return [];
    const truth = Math.log(record.anchor) + outcome;
    return row.q.map((value, index) => {
      const residual = truth - Math.log(value);
      return 2 * Math.max(LEVELS[index] * residual, (LEVELS[index] - 1) * residual);
    });
  });
  return losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null;
}

export function selectWidth(input, chronological = false, predict = robustForecast) {
  const start = Date.parse(input.day_start);
  const records = trainingRecords(input).filter(record => !chronological || record.start < start);
  const allowed = [];
  for (const record of records) {
    const comp = input.comparables.find(comp => titleKey(record.name) === titleKey(comp.name) && record.start === Date.parse(comp.day_start));
    if (comp) allowed.push(comp);
  }
  const consoleClass = targetMetadata(input)[0];
  if (records.length < 6) return { config: WIDTH_GRID[0], reason: 'fewer than six training titles', folds: [] };
  const folds = [];
  for (const comp of allowed) {
    const record = records.find(item => titleKey(item.name) === titleKey(comp.name) && item.start === Date.parse(comp.day_start));
    if (record.meta[0] !== consoleClass) continue;
    const held = heldInput(comp, allowed, chronological);
    if (trainingRecords(held).length < 6) continue;
    const output = predict(held, { ...DEFAULT_CONFIG, chronological });
    folds.push({ name: comp.name, start: record.start, training: trainingRecords(held).map(item => ({ name: item.name, start: item.start })),
      losses: WIDTH_GRID.map(config => titleLoss(compress(output, record.meta, config), record)) });
  }
  if (folds.length < 6) return { config: WIDTH_GRID[0], reason: 'fewer than six eligible inner titles in class', folds };
  const losses = WIDTH_GRID.map((_, index) => folds.reduce((sum, fold) => sum + fold.losses[index], 0) / folds.length);
  const chosen = losses.indexOf(Math.min(...losses));
  return { config: WIDTH_GRID[chosen], reason: 'inner whole-title minimum loss', folds, losses };
}

export function calibratedForecast(input, chronological = false) {
  const allowed = chronological ? { ...input, comparables: (input.comparables ?? []).filter(comp => Date.parse(comp.day_start) < Date.parse(input.day_start)) } : input;
  const selection = selectWidth(allowed, chronological);
  return compress(robustForecast(allowed, { ...DEFAULT_CONFIG, chronological: chronological && trainingRecords(allowed).length >= 6 }), targetMetadata(allowed), selection.config);
}
