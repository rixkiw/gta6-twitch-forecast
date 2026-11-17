import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forecast as legacy, trainingRecords, LEVELS, hourlyRows } from './legacy.ts';
import { GRID, forecastCandidate, heldInput, titleKey, recordsFor } from './research.ts';

const root = '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-validation';
const kit = process.argv[process.argv.indexOf('--kit') + 1];
if (!process.argv.includes('--kit') || !kit) throw Error('Usage: node validate-top20.ts --kit <kit>');
fs.mkdirSync(root, { recursive: true });
const reportPath = path.join(root, 'report.json');
if (fs.existsSync(reportPath)) throw Error('Audit report already exists; do not silently rerun a once-only audit.');
const cases = ['p00', 'p01', 'p02', 'p03'].map(name => JSON.parse(fs.readFileSync(path.join(kit, 'input', `${name}.in`), 'utf8')));
const base = cases[0];
const records = trainingRecords({ ...base, game: {} }).sort((left, right) => left.start - right.start);
const comps = records.map(record => base.comparables.find(comp => titleKey(comp.name) === titleKey(record.name) && Date.parse(comp.day_start) === record.start));
const split = Date.parse('2025-01-01T00:00:00Z');
const selectionComps = comps.filter(comp => Date.parse(comp.day_start) < split);
const auditComps = comps.filter(comp => Date.parse(comp.day_start) >= split);
const tests = [];
function test(name, body) { body(); tests.push(name); console.log(`PASS ${name}`); }
function valid(output) {
  assert.deepEqual(Object.keys(output), ['hours']);
  assert.equal(output.hours.length, 23);
  output.hours.forEach((row, index) => {
    assert.deepEqual(Object.keys(row), ['hour', 'q']);
    assert.equal(row.hour, index + 2);
    assert.equal(row.q.length, 5);
    row.q.forEach((value, quantile) => {
      assert.ok(Number.isFinite(value) && value > 0 && value <= 1e9);
      if (quantile) assert.ok(value >= row.q[quantile - 1]);
    });
  });
}
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null;
}
function score(output, record) {
  valid(output);
  const rows = output.hours.flatMap(row => {
    const outcome = record.outcomes[row.hour - 1];
    if (outcome == null) return [];
    const truth = Math.log(record.anchor) + outcome;
    const logs = row.q.map(Math.log);
    return [{ losses: logs.map((value, index) => 2 * Math.max(LEVELS[index] * (truth - value), (LEVELS[index] - 1) * (truth - value))),
      coverage: Number(truth >= logs[0] && truth <= logs[4]), absolute: Math.abs(truth - logs[2]),
      logWidth: logs[4] - logs[0], ratioWidth: row.q[4] / row.q[0] }];
  });
  const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const quantileLoss = LEVELS.map((_, index) => rows.reduce((sum, row) => sum + row.losses[index], 0) / rows.length);
  return { loss: quantileLoss.reduce((sum, value) => sum + value, 0) / 5, quantileLoss,
    coverage90: mean('coverage'), meanAbsoluteLog: mean('absolute'), medianAbsoluteLog: median(rows.map(row => row.absolute)),
    meanLogWidth: mean('logWidth'), meanRatioWidth: mean('ratioWidth'), hours: rows.length };
}
function aggregate(rows, key) {
  if (!rows.length) return null;
  const mean = field => rows.reduce((sum, row) => sum + row[key][field], 0) / rows.length;
  return { titles: rows.length, hours: rows.reduce((sum, row) => sum + row[key].hours, 0), loss: mean('loss'),
    quantileLoss: LEVELS.map((_, index) => rows.reduce((sum, row) => sum + row[key].quantileLoss[index], 0) / rows.length),
    coverage90: mean('coverage90'), meanLogMissPercent: 100 * Math.expm1(mean('meanAbsoluteLog')),
    medianTitleMedianMissPercent: 100 * Math.expm1(median(rows.map(row => row[key].medianAbsoluteLog))),
    meanLogWidth: mean('meanLogWidth'), meanRatioWidth: mean('meanRatioWidth') };
}
function paired(rows) {
  if (!rows.length) return null;
  let state = 17623;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const differences = [];
  const relatives = [];
  for (let draw = 0; draw < 5000; draw++) {
    let model = 0;
    let baseline = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[Math.floor(random() * rows.length)];
      model += row.model.loss;
      baseline += row.legacy.loss;
    }
    differences.push((model - baseline) / rows.length);
    relatives.push(model / baseline - 1);
  }
  differences.sort((left, right) => left - right);
  relatives.sort((left, right) => left - right);
  return { difference95: [differences[125], differences[4874]], relativeChange95: [relatives[125], relatives[4874]], draws: 5000, unit: 'titles' };
}
function summarize(rows) {
  const group = subset => ({ model: aggregate(subset, 'model'), legacy: aggregate(subset, 'legacy'), pairedBootstrap: paired(subset) });
  return { overall: group(rows), console: group(rows.filter(row => row.console)), details: rows };
}
function evaluate(targets, pool, config, chronological) {
  const details = [];
  for (const comp of targets) {
    const held = heldInput(comp, pool, chronological);
    if (chronological && trainingRecords(held).length < 6) continue;
    const record = records.find(record => record.start === Date.parse(comp.day_start) && titleKey(record.name) === titleKey(comp.name));
    const trained = trainingRecords(held);
    assert.ok(trained.every(item => titleKey(item.name) !== titleKey(record.name)));
    if (chronological) assert.ok(trained.every(item => item.start < record.start));
    const output = forecastCandidate(held, { ...config, retrospective: !chronological });
    details.push({ name: record.name, date: comp.day_start, console: record.meta[0] === 1,
      trainingTitles: trained.map(item => ({ name: item.name, date: new Date(item.start).toISOString() })),
      model: score(output, record), legacy: score(legacy(held), record) });
  }
  return summarize(details);
}

const integrity = { casesComparableIdentical: cases.every(input => JSON.stringify(input.comparables) === JSON.stringify(base.comparables)),
  titles: records.length, selectionTitles: selectionComps.length, auditTitles: auditComps.length,
  records: comps.map((comp, index) => {
    const record = records[index];
    const stamps = comp.hourly.map(row => Date.parse(row.from ?? row.at));
    return { name: record.name, date: comp.day_start, console: record.meta[0] === 1,
      preCheckpointRows: stamps.filter(stamp => stamp + 3600000 <= record.start + 3600000).length,
      duplicateStamps: stamps.length - new Set(stamps).size,
      alignedHours: stamps.every(stamp => Number.isFinite(stamp) && stamp % 3600000 === 0),
      utcMidnight: record.start % 86400000 === 0, observedOutcomes: record.outcomes.filter(value => value != null).length }
  }),
  targetHistory: cases.map(input => ({ id: input.id, checkpoint: input.checkpoint, rows: input.history_hourly.length,
    usableRows: hourlyRows(input.history_hourly, Date.parse(input.checkpoint)).size,
    recent12h: [...hourlyRows(input.history_hourly, Date.parse(input.checkpoint)).keys()].filter(stamp => stamp >= Date.parse(input.day_start) - 12 * 3600000 && stamp < Date.parse(input.day_start)).length })) };
test('input date, identity and hourly integrity', () => {
  assert.ok(integrity.casesComparableIdentical);
  assert.equal(new Set(records.map(record => titleKey(record.name))).size, records.length);
  assert.ok(integrity.records.every(row => row.utcMidnight && row.alignedHours && row.duplicateStamps === 0));
});
fs.writeFileSync(path.join(root, 'integrity.json'), JSON.stringify(integrity, null, 2));
console.log('Selection begins; audit outcomes are not scored.');
const selection = GRID.map(config => {
  const loo = evaluate(selectionComps, selectionComps, config, false);
  const chronological = evaluate(selectionComps, selectionComps, config, true);
  const eligible = loo.overall.model.loss <= 1.03 * loo.overall.legacy.loss && chronological.overall.model.loss <= 1.03 * chronological.overall.legacy.loss;
  console.log(JSON.stringify({ config, eligible, consoleLoss: loo.console.model.loss, overallLoss: loo.overall.model.loss, chronologicalLoss: chronological.overall.model.loss }));
  return { config, eligible, loo, chronological };
});
const ranked = [...selection].sort((left, right) => left.loo.console.model.loss - right.loo.console.model.loss);
const selected = ranked.find(report => report.eligible) ?? ranked[0];
const frozen = { selectedConfig: selected.config, selectionEligible: selected.eligible,
  protocolSHA256: createHash('sha256').update(fs.readFileSync('VALIDATION-PLAN.md')).digest('hex'),
  sourceSHA256: createHash('sha256').update(fs.readFileSync('research.ts')).digest('hex'), selection };
fs.writeFileSync(path.join(root, 'selection-frozen.json'), JSON.stringify(frozen, null, 2));
console.log('Selection frozen on disk. Starting once-only temporal audit.');
const auditChronological = evaluate(auditComps, comps, selected.config, true);
const auditRetrospective = evaluate(auditComps, comps, selected.config, false);
const allLoo = evaluate(comps, comps, selected.config, false);
const allChronological = evaluate(comps, comps, selected.config, true);
const ratio = group => group.model.loss / group.legacy.loss;
const checks = {
  selectionEligible: selected.eligible,
  consoleImprovement10Percent: ratio(allLoo.console) <= 0.9,
  overallWithin3Percent: ratio(allLoo.overall) <= 1.03,
  chronologicalWithin3Percent: ratio(allChronological.overall) <= 1.03,
  auditWithin3Percent: ratio(auditChronological.overall) <= 1.03,
  noSignificantRegression: [allLoo.overall, allChronological.overall, auditChronological.overall].every(group => group.pairedBootstrap.difference95[0] <= 0)
};
const gatePassed = Object.values(checks).every(Boolean);
const report = { integrity, ...frozen, auditChronological, auditRetrospective, allLoo, allChronological, checks, gatePassed,
  consoleBenefitConclusive: allLoo.console.pairedBootstrap.difference95[1] < 0,
  auditPasses: 1, tests, limitations: ['Audit titles are few; subgroup intervals can be wide.', 'Historical metadata is retrospectively compiled; only generic pre-source description keywords are parsed.', 'Official p00..p03 labels are absent; official score and rank cannot be measured.', 'Selection title scores are optimistic after configuration selection.'] };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ selectedConfig: selected.config, checks, gatePassed,
  allLoo: { overall: allLoo.overall, console: allLoo.console }, chronological: allChronological.overall, audit: auditChronological.overall }, null, 2));
