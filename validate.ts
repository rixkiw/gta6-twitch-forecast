import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forecast, trainingRecords, hourlyRows, metadata, persistence, LEVELS, DEFAULT_CONFIG } from './main.ts';

const HOUR = 3600000;
const root = '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-validation';
const kitIndex = process.argv.indexOf('--kit');
if (kitIndex < 0 || !process.argv[kitIndex + 1]) throw new Error('Usage: node validate.ts --kit <kit directory>');
const kit = process.argv[kitIndex + 1];
fs.mkdirSync(root, { recursive: true });
const cases = ['p00', 'p01', 'p02', 'p03'].map(name => JSON.parse(fs.readFileSync(path.join(kit, 'input', `${name}.in`), 'utf8')));
const source = fileURLToPath(new URL('./main.ts', import.meta.url));

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
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 65536);
}

function score(output, outcomes, anchor) {
  let loss = 0;
  let coverage = 0;
  let absolute = 0;
  let count = 0;
  for (const row of output.hours) {
    const ratio = outcomes[row.hour - 1];
    if (ratio == null) continue;
    const truth = Math.log(Math.max(1, anchor * Math.exp(ratio)));
    row.q.forEach((value, index) => {
      const error = truth - Math.log(value);
      loss += 2 * Math.max(LEVELS[index] * error, (LEVELS[index] - 1) * error);
    });
    coverage += truth >= Math.log(row.q[0]) && truth <= Math.log(row.q[4]) ? 1 : 0;
    absolute += Math.abs(truth - Math.log(row.q[2]));
    count++;
  }
  return { loss, coverage, absolute, count };
}

function aggregate(scores) {
  const sums = scores.reduce((total, item) => Object.fromEntries(Object.keys(total).map(key => [key, total[key] + item[key]])), { loss: 0, coverage: 0, absolute: 0, count: 0 });
  return { loss: sums.loss / (5 * sums.count), coverage90: sums.coverage / sums.count,
    typicalMedianMissPercent: 100 * Math.expm1(sums.absolute / sums.count), hours: sums.count };
}

/** Each outer launch is removed before both fitting and inner residual cross-fitting. */
function evaluate(config) {
  const base = cases[0];
  const records = trainingRecords({ ...base, game: {} });
  const results = [];
  for (const record of records) {
    const comp = base.comparables.find(item => item.name === record.name && Date.parse(item.day_start) === record.start);
    const known = comp.hourly.find(row => Date.parse(row.from) === record.start);
    const checkpoint = new Date(record.start + HOUR).toISOString();
    const held = { day_start: comp.day_start, checkpoint, game: { name: comp.name }, unlock: comp.unlock,
      platforms: comp.platforms, known: [{ ...known, hour: 1, until: checkpoint }],
      history_hourly: comp.hourly.filter(row => Date.parse(row.from) + HOUR <= Date.parse(checkpoint)),
      comparables: base.comparables.filter(item => item.name !== comp.name) };
    const predicted = forecast(held, config);
    valid(predicted);
    results.push({ name: record.name, console: metadata(comp.unlock, comp.platforms)[0] === 1,
      model: score(predicted, record.outcomes, record.anchor), baseline: score(persistence(record.anchor), record.outcomes, record.anchor) });
  }
  return { config, overall: aggregate(results.map(row => row.model)), baseline: aggregate(results.map(row => row.baseline)),
    console: aggregate(results.filter(row => row.console).map(row => row.model)),
    consoleBaseline: aggregate(results.filter(row => row.console).map(row => row.baseline)),
    launches: results.length, consoleLaunches: results.filter(row => row.console).length, details: results };
}

const tests = [];
function test(name, body) { body(); tests.push(name); console.log(`PASS ${name}`); }
test('schema, range, ordering, deterministic sparse/empty/zero-known fallbacks', () => {
  for (const input of [{}, { ...cases[0], known: [], comparables: [] },
    { ...cases[0], known: [{ hour: 1, viewers: 0 }], comparables: [] },
    { ...cases[0], comparables: [{ name: 'sparse', day_start: cases[0].day_start, hourly: [cases[0].known[0]] }] }]) {
    const first = forecast(input);
    valid(first);
    assert.equal(JSON.stringify(first), JSON.stringify(forecast(input)));
  }
});
test('missing comparable hours remain missing', () => {
  const comp = { name: 'sparse', day_start: cases[0].day_start, hourly: [cases[0].known[0]] };
  const records = trainingRecords({ comparables: [comp] });
  assert.equal(records.length, 1);
  assert.equal(records[0].outcomes[1], null);
  const observedZero = hourlyRows([{ from: cases[0].day_start, viewers: 0 }]);
  assert.equal(observedZero.get(Date.parse(cases[0].day_start)).viewers, 1);
  assert.equal(hourlyRows([{ from: cases[0].day_start, viewers: -1 }]).size, 0);
});
test('unknown metadata and nonfinite observations are safe', () => {
  assert.deepEqual(metadata('unverified', ''), [0, 0, 0]);
  assert.equal(hourlyRows([{ from: cases[0].day_start, viewers: Infinity }]).size, 0);
  valid(forecast({ ...cases[0], notes: '', platforms: '', comparables: cases[0].comparables.slice(0, 1) }));
});
test('target identity and not-a-launch exclusions', () => {
  const comp = cases[0].comparables[0];
  assert.equal(trainingRecords({ game: { name: comp.name }, comparables: [comp] }).length, 0);
  assert.equal(trainingRecords({ comparables: [{ ...comp, unlock: 'Not a launch. Tier: target-history' }] }).length, 0);
  assert.equal(trainingRecords({ game: { twitch_id: '7' }, comparables: [{ ...comp, twitch_id: 7 }] }).length, 0);
});
test('target future rows, overlapping intervals and target comparable cannot leak', () => {
  const original = cases[0];
  const poison = { from: original.checkpoint, at: original.checkpoint, viewers: 1e9, channels: 1, reads: 60 };
  const overlapping = { ...poison, from: new Date(Date.parse(original.checkpoint) - HOUR / 2).toISOString() };
  const attacked = { ...original, history: [...original.history, poison], history_hourly: [...original.history_hourly, poison, overlapping],
    comparables: [...original.comparables, { name: original.game.name, day_start: original.day_start,
      hourly: [original.known[0], poison] }] };
  assert.equal(JSON.stringify(forecast(original)), JSON.stringify(forecast(attacked)));
});
test('whole CLI: four isolated cases, deterministic bytes, empty directory', () => {
  const empty = fs.mkdtempSync(path.join(root, 'empty-'));
  const emptyOutput = path.join(empty, 'output');
  const result = spawnSync(process.execPath, [source], { env: { ...process.env, MAKEFUN_INPUT_DIR: empty, MAKEFUN_OUTPUT_DIR: emptyOutput }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(emptyOutput));
  for (let index = 0; index < cases.length; index++) {
    const work = fs.mkdtempSync(path.join(root, `p0${index}-`));
    const inputDir = path.join(work, 'input');
    const outputDir = path.join(work, 'output');
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, `p0${index}.in`), JSON.stringify(cases[index]));
    const options = { env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outputDir }, encoding: 'utf8', timeout: 8000 };
    const started = performance.now();
    const first = spawnSync(process.execPath, [source], options);
    const elapsed = performance.now() - started;
    assert.equal(first.status, 0, first.stderr);
    const outputFile = path.join(outputDir, `p0${index}.out`);
    const bytes = fs.readFileSync(outputFile, 'utf8');
    valid(JSON.parse(bytes));
    assert.deepEqual(fs.readdirSync(outputDir), [`p0${index}.out`]);
    assert.equal(spawnSync(process.execPath, [source], options).status, 0);
    assert.equal(fs.readFileSync(outputFile, 'utf8'), bytes);
    console.log(`CLI p0${index}: ${elapsed.toFixed(1)} ms, ${Buffer.byteLength(bytes)} bytes`);
  }
});

const grid = [
  { bandwidth: 3, context: false, metadata: false },
  { bandwidth: 3, context: false, metadata: true },
  { bandwidth: 3, context: true, metadata: true },
  { bandwidth: 1.5, context: true, metadata: true }
];
console.log('Declared four-choice grid; comparable LOO is selection performance, not unbiased final accuracy.');
const reports = grid.map(config => {
  const report = evaluate(config);
  console.log(JSON.stringify({ ...report, details: undefined }));
  return report;
});
const report = { tests, defaultConfig: DEFAULT_CONFIG, reports };
fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Report: ${path.join(root, 'report.json')}`);
