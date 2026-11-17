import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { forecast, DEFAULT_CONFIG, trainingRecords, targetMetadata, LEVELS, launchPlatforms } from './main.ts';
import { forecast as legacy } from './legacy.ts';
import { WIDTH_GRID, compress, selectWidth } from './calibration.ts';
import { heldInput, titleKey } from './research.ts';

const root = '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-validation';
const kit = process.argv[process.argv.indexOf('--kit') + 1];
const cases = ['p00', 'p01', 'p02', 'p03'].map(name => JSON.parse(fs.readFileSync(path.join(kit, 'input', `${name}.in`), 'utf8')));
const base = cases[0];
const records = trainingRecords({ ...base, game: {} }).sort((left, right) => left.start - right.start);
const comps = records.map(record => base.comparables.find(comp => titleKey(comp.name) === titleKey(record.name) && Date.parse(comp.day_start) === record.start));
const hashes = Object.fromEntries(['worker-result.json', 'report.json', 'selection-frozen.json'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function score(output, record) {
  const rows = output.hours.flatMap(row => {
    const outcome = record.outcomes[row.hour - 1];
    if (outcome == null) return [];
    const truth = Math.log(record.anchor) + outcome;
    const logs = row.q.map(Math.log);
    return [{ loss: logs.map((value, index) => 2 * Math.max(LEVELS[index] * (truth - value), (LEVELS[index] - 1) * (truth - value))),
      coverage: logs.map(value => Number(truth <= value)), interval: Number(truth >= logs[0] && truth <= logs[4]),
      miss: Math.abs(truth - logs[2]), width: logs[4] - logs[0] }];
  });
  const quantileLoss = LEVELS.map((_, index) => mean(rows.map(row => row.loss[index])));
  return { loss: mean(quantileLoss), quantileLoss, quantileCoverage: LEVELS.map((_, index) => mean(rows.map(row => row.coverage[index]))),
    coverage90: mean(rows.map(row => row.interval)), meanAbsoluteLog: mean(rows.map(row => row.miss)), meanLogWidth: mean(rows.map(row => row.width)), hours: rows.length };
}
function aggregate(rows, key) {
  if (!rows.length) return null;
  const average = field => mean(rows.map(row => row[key][field]));
  return { titles: rows.length, loss: average('loss'), quantileLoss: LEVELS.map((_, index) => mean(rows.map(row => row[key].quantileLoss[index]))),
    quantileCoverage: LEVELS.map((_, index) => mean(rows.map(row => row[key].quantileCoverage[index]))), coverage90: average('coverage90'),
    meanAbsoluteLog: average('meanAbsoluteLog'), logMissPercent: 100 * Math.expm1(average('meanAbsoluteLog')), meanLogWidth: average('meanLogWidth') };
}
function bootstrap(rows, key) {
  if (!rows.length) return null;
  let state = 17623;
  const diffs = [], relatives = [];
  for (let draw = 0; draw < 5000; draw++) {
    let model = 0, baseline = 0;
    for (let index = 0; index < rows.length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const row = rows[Math.floor(state / 4294967296 * rows.length)];
      model += row[key].loss;
      baseline += row.baseline.loss;
    }
    diffs.push((model - baseline) / rows.length);
    relatives.push(model / baseline - 1);
  }
  diffs.sort((left, right) => left - right);
  relatives.sort((left, right) => left - right);
  return { difference95: [diffs[125], diffs[4874]], relativeChange95: [relatives[125], relatives[4874]], unit: 'whole titles', draws: 5000 };
}
function summarize(rows, key) {
  const group = subset => ({ model: aggregate(subset, key), baseline: aggregate(subset, 'baseline'), pairedBootstrap: bootstrap(subset, key) });
  return { overall: group(rows), console: group(rows.filter(row => row.console)), other: group(rows.filter(row => !row.console)) };
}
const cache = new Map();
function cached(input, config) {
  const key = JSON.stringify([input.game.name, input.comparables.map(comp => [comp.name, comp.day_start]), config.chronological]);
  if (!cache.has(key)) cache.set(key, forecast(input, config));
  return cache.get(key);
}
function noteInput(held) {
  return { ...held, unlock: undefined, platforms: undefined,
    notes: `Category (Twitch category 123), released ${held.day_start.slice(0, 10)} on ${held.platforms}; real unlock: ${held.unlock}` };
}
const modes = {};
for (const chronological of [false, true]) {
  const details = [];
  for (const comp of comps) {
    const record = records.find(item => titleKey(item.name) === titleKey(comp.name));
    const held = heldInput(comp, comps, chronological);
    const runtime = noteInput(held);
    assert.deepEqual(targetMetadata(runtime), targetMetadata(held));
    const fitConfig = { ...DEFAULT_CONFIG, chronological: chronological && trainingRecords(held).length >= 6 };
    const corrected = cached(runtime, fitConfig);
    assert.deepEqual(corrected, forecast(held, fitConfig));
    const selection = selectWidth(runtime, chronological, cached);
    for (const fold of selection.folds) {
      assert.ok(titleKey(fold.name) !== titleKey(comp.name));
      assert.ok(fold.training.every(item => titleKey(item.name) !== titleKey(comp.name) && titleKey(item.name) !== titleKey(fold.name)));
      if (chronological) assert.ok(fold.training.every(item => item.start < fold.start && fold.start < record.start));
    }
    const baseline = score(legacy(held), record);
    const fixed = WIDTH_GRID.map(config => score(compress(corrected, record.meta, config), record));
    const nested = score(compress(corrected, record.meta, selection.config), record);
    details.push({ name: comp.name, start: record.start, console: !!record.meta[0], trainingTitles: trainingRecords(held).map(item => ({ name: item.name, start: item.start })),
      baseline, legacyNotes: score(legacy(runtime), record), corrected: score(corrected, record), fixed, nested, selection });
    console.log(chronological ? 'chronological' : 'retrospective', comp.name, selection.config, selection.reason);
  }
  const fixed = WIDTH_GRID.map((config, index) => ({ config, status: 'exploratory selection-biased', ...summarize(details.map(row => ({ ...row, model: row.fixed[index] })), 'model') }));
  modes[chronological ? 'chronological' : 'retrospective'] = { nested: summarize(details, 'nested'), corrected: summarize(details, 'corrected'), legacyNotes: summarize(details, 'legacyNotes'), fixed, details };
}
const relative = group => group.model.loss / group.baseline.loss - 1;
const gates = { consoleGain: relative(modes.retrospective.nested.console) <= -0.1,
  overall: relative(modes.retrospective.nested.overall) <= 0.03, chronological: relative(modes.chronological.nested.overall) <= 0.03 };
const report = { auditStatus: 'SPENT: no second unbiased audit exists; nested reuse is not clean audit evidence', plan: path.join(root, 'followup-plan.md'),
  baseline: 'original robust model with explicit launch covariates; chronological baseline uses only prior outer titles, original LOO residuals',
  chronologicalCandidate: 'strict prior launches in outer, inner and residual calibration; original unshrunk fallback when insufficient inner titles',
  count: { titles: records.length, console: records.filter(record => record.meta[0]).length }, modes, gates,
  gatePassed: Object.values(gates).every(Boolean), gateInterpretation: 'point estimates only, not proof; bootstrap intervals reflect small title sample, not all selection uncertainty',
  targetMetadata: cases.map((input, index) => ({ case: `p0${index}`, launchPlatforms: launchPlatforms(input.notes), metadata: targetMetadata(input) })), preservedHashes: hashes, cachedFits: cache.size };
for (const [name, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), hash);
fs.writeFileSync(path.join(root, 'followup-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ gates, nested: Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, value.nested])) }, null, 2));
