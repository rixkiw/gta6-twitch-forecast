import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forecast, hourlyRows, trainingRecords, metadata, launchPlatforms, targetMetadata, DEFAULT_CONFIG } from './main.ts';
import { WIDTH_GRID, compress, selectWidth } from './calibration.ts';
import { createHash } from 'node:crypto';
import { forecast as legacy } from './legacy.ts';
import { GRID, forecastCandidate, recordsFor, heldInput, titleKey } from './research.ts';

const kit = process.argv[process.argv.indexOf('--kit') + 1];
if (!process.argv.includes('--kit') || !kit) throw Error('Usage: node test-top20.ts --kit <kit>');
const root = '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-validation';
fs.mkdirSync(root, { recursive: true });
const cases = ['p00', 'p01', 'p02', 'p03'].map(name => JSON.parse(fs.readFileSync(path.join(kit, 'input', `${name}.in`), 'utf8')));
const tests = [];
const timings = [];
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
const models = [forecast, ...GRID.map(config => input => forecastCandidate(input, config))];
test('schema and determinism for empty, sparse, zeros and unknown metadata', () => {
  const start = cases[0].day_start;
  for (const model of models) for (const input of [{}, { ...cases[0], comparables: [], known: [] },
    { ...cases[0], known: [{ hour: 1, viewers: 0 }], comparables: [] },
    { ...cases[0], notes: '', platforms: '', comparables: [{ name: 'sparse', day_start: start, hourly: [{ from: start, viewers: 0 }] }] }]) {
    valid(model(input));
    assert.equal(JSON.stringify(model(input)), JSON.stringify(model(input)));
  }
  assert.deepEqual(metadata('unknown', ''), [0, 0, 0]);
  assert.equal(hourlyRows([{ from: start, viewers: 0 }]).get(Date.parse(start)).viewers, 1);
  assert.equal(hourlyRows([{ from: start, viewers: Infinity }]).size, 0);
  const record = trainingRecords({ comparables: [{ name: 'sparse', day_start: start, hourly: [{ from: start, viewers: 0 }] }] })[0];
  assert.equal(record.outcomes[0], 0);
  assert.equal(record.outcomes[1], null);
});
test('metadata ignores post-source outcome summaries', () => {
  assert.deepEqual(metadata('unverified Source: early access rolling midnight local 999k', 'PS5'), [1, 0, 0]);
  assert.deepEqual(metadata('unverified Tier: early access', 'PC (PS5 later)'), [0, 0, 0]);
});
test('runtime note platforms equal explicit launch covariates including future ports', () => {
  for (const input of cases) {
    assert.deepEqual(targetMetadata(input), [1, 1, 0]);
    const explicit = { ...input, platforms: launchPlatforms(input.notes) };
    assert.deepEqual(forecast(input), forecast(explicit));
  }
  for (const [platforms, expected] of [['PC (PS5 later)', 0], ['PS5, Xbox (PC later)', 1], ['PC, PS5', 0]]) {
    const notes = `Anonymous (Twitch category 123), released 2024-01-01 on ${platforms}; real unlock: Rolling midnight local. No early access. Source: premium early access PC`;
    assert.deepEqual(targetMetadata({ notes }), [expected, 1, 0]);
    assert.deepEqual(targetMetadata({ notes }), targetMetadata({ unlock: notes, platforms }));
  }
  assert.equal(launchPlatforms('Anonymous (PC) Source: released yesterday on PS5'), '');
  assert.deepEqual(targetMetadata({ notes: 'Anonymous (PS5), unknown; Research note: released yesterday on PS5 rolling' }), [0, 0, 0]);
});
test('width family preserves corrected robust medians exactly', () => {
  const input = cases[0];
  const original = forecast(input, DEFAULT_CONFIG);
  for (const config of WIDTH_GRID) {
    const output = compress(original, targetMetadata(input), config);
    valid(output);
    output.hours.forEach((row, index) => assert.equal(row.q[2], original.hours[index].q[2]));
  }
  const selection = selectWidth(input);
  assert.deepEqual(forecast(input), compress(original, targetMetadata(input), selection.config));
  forecast(input).hours.forEach((row, index) => assert.equal(row.q[2], original.hours[index].q[2]));
});
test('exact duplicates cannot change observation weights or model forecasts', () => {
  const from = cases[0].day_start;
  const rows = [{ from, viewers: 10, reads: 2 }, { from, viewers: 30, reads: 1 }];
  assert.deepEqual(hourlyRows(rows), hourlyRows([...rows, rows[0]]));
  const original = cases[0];
  const attacked = { ...original, comparables: [...original.comparables.map(comp => ({ ...comp, hourly: [...comp.hourly, ...comp.hourly] })), ...original.comparables],
    history_hourly: [...original.history_hourly, ...original.history_hourly] };
  for (const model of models) assert.equal(JSON.stringify(model(original)), JSON.stringify(model(attacked)));
});
test('target future rows and heldout identity never enter fitting', () => {
  const original = cases[0];
  const poison = { from: original.checkpoint, viewers: 1e9, channels: 1 };
  const overlap = { ...poison, from: new Date(Date.parse(original.checkpoint) - 1800000).toISOString() };
  const minuteOnly = { ...original, history_hourly: [] };
  const minuteAttack = { ...minuteOnly, history: [...minuteOnly.history, poison, overlap, { at: original.checkpoint, viewers: 1e9 }] };
  assert.deepEqual(forecast(minuteOnly), forecast(minuteAttack));
  const attacked = { ...original, history_hourly: [...original.history_hourly, poison, overlap], history: [...original.history, poison],
    comparables: [...original.comparables, { name: original.game.name, day_start: original.day_start, hourly: [original.known[0], poison] }] };
  for (const model of models) assert.equal(JSON.stringify(model(original)), JSON.stringify(model(attacked)));
  for (const comp of original.comparables) {
    const held = heldInput(comp, original.comparables, false);
    assert.ok(trainingRecords(held).every(record => titleKey(record.name) !== titleKey(comp.name)));
  }
});
test('chronological training excludes same-date and future titles including calibration', () => {
  for (const comp of cases[0].comparables) {
    const held = heldInput(comp, cases[0].comparables, false);
    const records = recordsFor(held);
    assert.ok(records.every(record => record.start < Date.parse(comp.day_start)));
    const filtered = { ...held, comparables: held.comparables.filter(other => Date.parse(other.day_start) < Date.parse(comp.day_start)) };
    for (const config of [GRID[0], GRID[3]]) assert.equal(JSON.stringify(forecastCandidate(held, config)), JSON.stringify(forecastCandidate(filtered, config)));
  }
});
test('legacy preserved and corrected default matches original with equivalent covariates', () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('./legacy.ts', import.meta.url))).digest('hex'), 'f6e6d3efd12c1e2de013ad1352286b00169b115bca041b22ba7eb807911884ac');
  for (const input of cases) {
    const explicit = { ...input, platforms: launchPlatforms(input.notes) };
    assert.equal(JSON.stringify(forecast(input, DEFAULT_CONFIG)), JSON.stringify(legacy(explicit)));
  }
});
test('actual CLI: empty input and four separately isolated cases twice within eight seconds', () => {
  const source = fileURLToPath(new URL('./main.ts', import.meta.url));
  const empty = fs.mkdtempSync(path.join(root, 'empty-'));
  const emptyOutput = path.join(empty, 'output');
  const emptyRun = spawnSync(process.execPath, [source], { env: { ...process.env, MAKEFUN_INPUT_DIR: empty, MAKEFUN_OUTPUT_DIR: emptyOutput }, encoding: 'utf8', timeout: 8000 });
  assert.equal(emptyRun.status, 0, emptyRun.stderr);
  assert.ok(!fs.existsSync(emptyOutput));
  cases.forEach((input, index) => {
    const work = fs.mkdtempSync(path.join(root, `p0${index}-`));
    const inputDir = path.join(work, 'input');
    const outputDir = path.join(work, 'output');
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, `p0${index}.in`), JSON.stringify(input));
    const runs = [];
    let bytes;
    for (let repeat = 0; repeat < 2; repeat++) {
      const started = performance.now();
      const result = spawnSync(process.execPath, [source], { env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outputDir }, encoding: 'utf8', timeout: 8000 });
      runs.push(performance.now() - started);
      assert.equal(result.status, 0, result.stderr);
      const output = fs.readFileSync(path.join(outputDir, `p0${index}.out`), 'utf8');
      valid(JSON.parse(output));
      if (bytes) assert.equal(output, bytes);
      bytes = output;
    }
    assert.deepEqual(fs.readdirSync(outputDir), [`p0${index}.out`]);
    timings.push({ case: `p0${index}`, milliseconds: runs, bytes: Buffer.byteLength(bytes) });
  });
});
fs.writeFileSync(path.join(root, 'followup-tests.json'), JSON.stringify({ node: process.version, tests, timings }, null, 2));
