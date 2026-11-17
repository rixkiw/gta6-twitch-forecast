# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rixkiw/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rixkiw/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Offline Node 22 probabilistic forecasts for GTA VI launch-day Twitch hourly viewers. Standard-library only; no network access, dependencies, outcome lookup, or game-specific forecast branches. Contest scenario metadata is treated as supplied, not independently verified.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
node validate.ts --kit /path/to/gta6-twitch-ccu-forecast-01-kit
node test-top20.ts --kit /path/to/gta6-twitch-ccu-forecast-01-kit
node followup-validation.ts --kit /path/to/gta6-twitch-ccu-forecast-01-kit
```

## Method

The forecast anchors every hour to the observed hour-one viewer count. Each eligible comparable contributes its day-one log viewer ratio at that hour; missing hourly observations are omitted, never filled as zero. Exact duplicate observation rows are ignored before weighted hourly aggregation; duplicate title/date curves contribute once. A robust ridge local-linear fit predicts the conditional log ratio. Similarity uses generic log anchor size and softly weighted console-only, rolling-midnight and early access description features. Recent pre-checkpoint trend and viewers per channel enter only when observable; their coefficients shrink toward zero. The final quantiles combine leave-one-launch-out residuals with a weak log-persistence normal prior, with extra dispersion for small effective samples. Unknown/zero hour one anchors to one viewer and naturally receives a wide fallback distribution. Output is finite, ordered and clamped to the required range.

The four-choice bandwidth/context/metadata grid is evaluated by genuine leave-one-launch-out over supplied comparable launches. The selected bandwidth is 1.5, with context and generic metadata enabled. Selection scores are not unbiased accuracy estimates. Launches are few, not exchangeable with a global console-only release, and rolling unlocks do not align perfectly to UTC; the 90% interval is consequently a diagnostic, not a guarantee. The GTA pre-release history is never a training launch curve; sparse recent history may inform trend only if enough observations fall before checkpoint. Practice target outcomes were not used for selection.

For reproducibility, the continuous features are `ln(hour1)/2`, clipped `ln(hour1/median(previous 12h))/2` (at least three observed hours), and clipped `ln(viewers/channels)/2`. Missing feature differences are zero. Squared feature distances have weights 1, 0.35, 0.35, 1.5, 1.5, 1.5; analogue weight is `0.05 + 0.95*exp(-distance/(2*bandwidth^2))`. The seven-coefficient regression has ridge penalties 0.5 for its intercept and 4 for each slope; three fitting passes use Huber cutoff 1.5 after the initial fit. Description parsing stops before source/tier/research summaries, avoiding outcome notes. Early access and simultaneous/global PC launches receive less similarity to console rolling launches through these generic metadata distances, rather than being discarded.

For each forecast hour, each training launch is removed in turn to generate its prediction residual. These residuals receive target similarity weights and Gaussian smoothing with log standard deviation `0.1 + 0.12*sqrt((hour-1)/23) + 0.3/sqrt(max(1,effectiveCount))`. Four normal pseudo-observations centered at persistence use standard deviation `max(0.2,0.15*sqrt(hour-1))`. Quantiles are inverted from this mixture. In outer validation, the held-out launch is excluded from both location fitting and this inner residual calibration. There is no interpolation across missing outcomes or temporal extrapolation from future target rows. History intervals must finish by checkpoint, capped at the end of hour one; minute history is conservatively treated as hour-long if no hourly history is supplied.

## Validation

`node validate.ts --kit <kit>` tests schema, bounds, ordering, deterministic serialization, empty and sparse inputs, zero/missing anchors, unknown metadata, target exclusion and future/overlapping-history leakage. It also runs all four practice input files in isolated temporary directories under `/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-validation/` and reports launch-level LOO versus persistence.

On the 37 comparable launch curves (851 observed launch-day hours), the selected model's LOO pinball loss is 0.4054 versus persistence 0.9297; 90% band coverage is 93.4% versus 62.4%, and mean absolute log error corresponds to 82.4% versus 213.3% typical multiplicative miss. The console-only subgroup has just 8 launches (184 hours): loss 0.1993 versus 0.3226, coverage 99.5% versus 79.9%, and typical miss 29.6% versus 67.7%. These are in-sample selection diagnostics across folds, not the unavailable official server score.

| Bandwidth | Context | Metadata | LOO loss | Console loss |
| --- | --- | --- | --- | --- |
| 3 | No | No | 0.43677 | 0.27508 |
| 3 | No | Yes | 0.40945 | 0.23407 |
| 3 | Yes | Yes | 0.41621 | 0.22819 |
| 1.5 | Yes | Yes | 0.40541 | 0.19934 |

This broader launch set includes initially quiet categories followed by large global-unlock surges; its persistence loss need not match the published practice-target baseline. Whole-program tests on p00 through p03 check outputs and leakage, not target forecast accuracy: their held-out answers were neither read nor hand-written. On Node v22.22.3, measured cold CLI runs took about 0.31–0.43 seconds per case and produced about 2.5 KB each. Full LOO details and test logs remain outside git under the validation workspace. Small-sample tails, correlated franchise curves and an unprecedented target scale limit transferability; console subgroup coverage is visibly conservative.

## Temporal validation and rejected candidate

The original accepted implementation is preserved in `legacy.ts`, attributed to
the previous recorded agent's commit `d8ed01e`. The forecast default retains that
robust regression and residual mixture. Production also removes exact repeated
observations and corrects note-derived launch metadata, as described below.
Conflicting observations retain reads-weighted averaging; conflicting duplicate
title/date curves retain the first eligible curve, so conflict order can matter.

`VALIDATION-PLAN.md` records the six-choice grid and gate declared before scoring.
`research.ts` implements generic hierarchical analogue weights, weighted empirical
log-curve quantiles, and an alternative Huber location with chronological held-title
residual calibration. Quantiles interpolate weighted sample midpoints. Residuals
pool five adjacent hours with equal total weight per title; each calibration fit
uses only earlier launches, with at least four prior titles. The selected candidate
was empirical curves, console mismatch weight 0.08 and log-anchor bandwidth 2.
All candidates and failures are retained in the external report.

Selection uses 18 titles before 2025; the once-only temporal audit uses 19 titles
from 2025 onward. Chronological evaluation requires six earlier titles and excludes
same-date/future titles from fitting and calibration. Retrospective LOO permits
future comparables and is explicitly a different diagnostic. The original model's
inner LOO is retained for baseline comparison and can use later titles within the
outer fold's allowed historical training set. Practice inputs themselves contain
comparables launched after some practice targets; the retained contest default
uses those supplied analogues, so it is not a historical deployment simulation.

| Evaluation | Titles | Candidate loss | Legacy loss |
| --- | --- | --- | --- |
| All-title retrospective LOO | 37 | 0.415169 | 0.405414 |
| Console retrospective LOO | 8 | 0.205680 | 0.199336 |
| All chronological eligible folds | 31 | 0.533763 | 0.566655 |
| Chronological audit, 2025+ | 19 | 0.458526 | 0.471748 |
| Console chronological audit | 3 | 0.249181 | 0.214109 |

**Rejected:** the gate required at least 10% lower console LOO loss; instead loss
increased 3.18%. The paired title-bootstrap 95% interval for console loss change
is [-0.03519, 0.04873], or [-17.20%, +25.12%]. Audit overall change has interval
[-0.10006, 0.06211]. These small samples do not establish a benefit. No further
configuration was tuned against the audit in that first experiment. The followup
reuses spent data with nested evaluation. A syntax error was fixed before any
scores ran; a retrospective-mode switch was added before selection so LOO and
chronological folds evaluate their declared training sets.

Console coverage fell from 99.46% to 97.28%; mean log interval width fell from
2.5612 to 1.7521, but central predictions worsened. Mean-log multiplicative miss
rose from 29.64% to 38.14%; median of per-title median misses rose from 22.76% to
28.76%. Per-quantile loss, both width measures, coverage, miss metrics and paired
5,000-title-bootstrap intervals for every group are in the external `report.json`.
Titles receive equal evaluation weight; hours are never bootstrap units. The
median statistic is explicitly a median of title medians, not a pooled-hour median.

Integrity checks found aligned UTC launch days, unique normalized launch titles,
no repeated timestamps, and matching comparables across all four inputs. Each
target has 12 observed prelaunch hours in the recent 12-hour window, so trend is
available; future history is ignored. Zero observations remain observed (floored
to one for logs), distinct from missing rows. Input metadata are scenario facts.

Evidence stays outside git at
`/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-top20-validation/`.
The audit runner refuses to overwrite an existing report; a genuinely fresh
replication requires explicitly archiving that report first and is a replication,
not a new unbiased audit. `test-top20.ts` is independently rerunnable and tests
all six candidates plus the default, duplicates, held-title exclusion, chronology,
future leakage, sparse/zero inputs and actual isolated CLI runs twice per case.
The eight measured Node 22.22.3 CLI executions took 0.48–1.35 seconds each,
with deterministic outputs of 2,534–2,544 bytes; empty input created no output.
The supplied accepted official loss 0.189076 was not remeasured. Official target
labels are absent; neither improvement nor a top-20 rank is established.

Provenance: the person's original request is stored verbatim outside this repo at
`/home/ubuntu/.hermes/cache/scratch/makefun-five/user-request.txt`. Their latest
steering is “intinya harus top rank minimal 20 aja , bisa gak? disemua campaign”.
The model-validation requirements are coordinator delegation, not that opening
prompt. This worker made no submission; the coordinator reviews independently.

## Followup: metadata and nested spread calibration

`launchPlatforms` extracts only the launch clause following `released ... on`
before parentheses, semicolons or sentence boundaries. Thus a category ID before
the release clause cannot hide PS5, and a future PC port cannot change launch
class. Note-derived unlock flags come only from the `real unlock:`/`unlock:`
clause before Source/Tier/Research note. No title names infer metadata. All four
actual input notes parse as console-only rolling, with no early-access flag.

The default keeps the original robust ridge fit, persistence prior and residual
mixture; it selects a log-spread multiplier around its computed q50 using
crossfitted whole titles of the same console class. Six predeclared choices are
metadata-only, console .45/.65/.85, and all-class .65/.85. Fewer than six training
or eligible calibration titles uses no compression. Both anchor and q50 are
unchanged by compression. Exact duplicate comparables do not multiply folds.
`robustForecast` exposes the uncompressed corrected model. `legacy.ts` remains
byte-preserved and attributed to the previous agent.

The 2025+ audit is **spent**. There is no second unbiased audit. These nested
results reuse known data and are exploratory. Outer targets are absent from all
inner fits; chronological inner folds and predictive residual fits use strictly
prior titles. With fewer than six outer training titles, chronology uses the
original unshrunk residual fit. The historical baseline retains original LOO
residuals inside its allowed prior outer training pool.

| Nested evaluation | Titles | Model loss | Original loss | Change |
| --- | --- | --- | --- | --- |
| Retrospective overall | 37 | 0.400060 | 0.405414 | -1.32% |
| Retrospective console | 8 | 0.163352 | 0.199336 | -18.05% |
| Chronological overall | 37 | 0.522544 | 0.521922 | +0.12% |
| Chronological console | 8 | 0.238714 | 0.222138 | +7.46% |

The declared point gates pass: >=10% console gain and <=3% overall/chronological
regression. This is not confidence proof. Console retrospective paired-title
bootstrap relative-change 95% interval is [-26.62%, -9.15%]; overall chronology
is [-3.21%, +4.62%]. Chronological console uncertainty is [+2.08%, +14.28%].
Every chronological console fold falls back because only zero to five eligible
prior inner console titles exist; no chronological shrinkage benefit is measured.
Console retrospective 90% coverage changes from 99.46% to 91.85%, mean log width
from 2.5612 to 1.1525, with identical median miss (mean absolute log 0.25959).
All fixed configurations are separately marked selection-biased in the report.

External `followup-plan.md` precedes scoring; `followup-report.json` contains all
folds, selections, losses, per-quantile coverage, miss, widths and title bootstrap
intervals. `followup-worker-result.json` records provenance and final runtime
tests. Original rejection artifacts remain intact. No official outcomes were
used, no top-20 claim is established, and no submission was made.

## Data

See [DATA.md](DATA.md) for attribution and licence limitations. Kit observations and counts are not included in this repository.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s1kbd32j&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
