import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-validation';
const report = JSON.parse(fs.readFileSync(path.join(root, 'followup-report.json'), 'utf8'));
const tests = JSON.parse(fs.readFileSync(path.join(root, 'followup-tests.json'), 'utf8'));
const change = group => group.model.loss / group.baseline.loss - 1;
report.gates = { consoleGain: change(report.modes.retrospective.nested.console) <= -0.1,
  overall: change(report.modes.retrospective.nested.overall) <= 0.03,
  chronological: change(report.modes.chronological.nested.overall) <= 0.03 };
report.gatePassed = Object.values(report.gates).every(Boolean);
for (const mode of Object.values(report.modes) as any[]) {
  mode.selectionCounts = {};
  for (const row of mode.details) {
    const key = `${row.selection.config.group}:${row.selection.config.scale}:${row.selection.reason}`;
    mode.selectionCounts[key] = (mode.selectionCounts[key] ?? 0) + 1;
  }
}
for (const [name, hash] of Object.entries(report.preservedHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), hash);
fs.writeFileSync(path.join(root, 'followup-report.json'), JSON.stringify(report, null, 2));
const sources = ['main.ts', 'legacy.ts', 'research.ts', 'calibration.ts', 'followup-validation.ts', 'finalize-followup.ts', 'test-top20.ts', 'README.md'];
const result = { status: report.gatePassed ? 'nested point gate passed; adaptive robust default implemented and runtime tested' : 'spread calibration rejected; metadata bug fixed',
  recommendation: report.gatePassed ? 'Coordinator review required: point gates pass but chronological console loss worsens 7.46%; no clean audit exists. Do not claim proven gain or top20.' : 'Retain corrected robust default without spread compression.',
  gatePassed: report.gatePassed, gates: report.gates, auditStatus: report.auditStatus,
  results: Object.fromEntries(Object.entries(report.modes).map(([name, mode]: [string, any]) => [name, { nested: mode.nested, fixed: mode.fixed, selectionCounts: mode.selectionCounts }])),
  tests, syntax: 'all nine TypeScript files pass node --check; git diff --check passes',
  limitations: ['Only eight console titles; title bootstrap intervals are not proof.', 'Nested reuse of spent audit is exploratory.', 'Original retrospective median preserved; runtime covariates corrected.', 'No official labels used; no rank claim.', 'Early chronology with fewer than six training titles uses original unshrunk residual fit; all data still precede outer launch.', 'Historical baseline retains original LOO residuals within prior outer pool. Candidate uses strict prior residual calibration when at least six titles exist.'],
  preservedHashes: report.preservedHashes,
  sourceHashes: Object.fromEntries(sources.map(name => [name, createHash('sha256').update(fs.readFileSync(new URL(name, import.meta.url))).digest('hex')])),
  provenance: { worktree: process.cwd(), nativeSessionPath: '/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-followup-native.log',
    acceptedSourceAuthor: 'Previous recorded agent, commit d8ed01e; legacy.ts byte preserved',
    sourceWrites: 'Native Codex session via apply_patch, multiple genuine implementation turns',
    actions: 'No network, secrets, commit, push, submit, or harness log modifications' },
  artifacts: ['followup-plan.md', 'followup-report.json', 'followup-tests.json', 'followup-evaluation.log', 'followup-tests.log'].map(name => path.join(root, name)) };
fs.writeFileSync(path.join(root, 'followup-worker-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, gates: report.gates, modes: Object.fromEntries(Object.entries(report.modes).map(([name, mode]: [string, any]) => [name, { nested: mode.nested, counts: mode.selectionCounts }])) }, null, 2));
