# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rixkiw/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rixkiw/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Offline Node 22 probabilistic forecasts for GTA VI launch-day Twitch hourly viewers. Standard-library only; no network access, dependencies, outcome lookup, or game-specific forecast branches. Contest scenario metadata is treated as supplied, not independently verified.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
node validate.ts --kit /path/to/gta6-twitch-ccu-forecast-01-kit
```

## Method

The forecast anchors every hour to the observed hour-one viewer count. Each eligible comparable contributes its day-one log viewer ratio at that hour; missing hourly observations are omitted, never filled as zero. A robust ridge local-linear fit predicts the conditional log ratio. Similarity uses generic log anchor size and softly weighted console-only, rolling-midnight and early access description features. Recent pre-checkpoint trend and viewers per channel enter only when observable; their coefficients shrink toward zero. The final quantiles combine leave-one-launch-out residuals with a weak log-persistence normal prior, with extra dispersion for small effective samples. Unknown/zero hour one anchors to one viewer and naturally receives a wide fallback distribution. Output is finite, ordered and clamped to the required range.

The four-choice bandwidth/context/metadata grid is evaluated by genuine leave-one-launch-out over supplied comparable launches. The selected bandwidth is 1.5, with context and generic metadata enabled. Selection scores are not unbiased accuracy estimates. Launches are few, not exchangeable with a global console-only release, and rolling unlocks do not align perfectly to UTC; the 90% interval is consequently a diagnostic, not a guarantee. The GTA pre-release history is never a training launch curve; sparse recent history may inform trend only if enough observations fall before checkpoint. Practice target outcomes were not used for selection.

For reproducibility, the continuous features are `ln(hour1)/2`, clipped `ln(hour1/median(previous 12h))/2` (at least three observed hours), and clipped `ln(viewers/channels)/2`. Missing feature differences are zero. Squared feature distances have weights 1, 0.35, 0.35, 1.5, 1.5, 1.5; analogue weight is `0.05 + 0.95*exp(-distance/(2*bandwidth^2))`. The seven-coefficient regression has ridge penalties 0.5 for its intercept and 4 for each slope; three fitting passes use Huber cutoff 1.5 after the initial fit. Description parsing stops before source/tier/research summaries, avoiding outcome notes. Early access and simultaneous/global PC launches receive less similarity to console rolling launches through these generic metadata distances, rather than being discarded.

For each forecast hour, each training launch is removed in turn to generate its prediction residual. These residuals receive target similarity weights and Gaussian smoothing with log standard deviation `0.1 + 0.12*sqrt((hour-1)/23) + 0.3/sqrt(max(1,effectiveCount))`. Four normal pseudo-observations centered at persistence use standard deviation `max(0.2,0.15*sqrt(hour-1))`. Quantiles are inverted from this mixture. In outer validation, the held-out launch is excluded from both location fitting and this inner residual calibration. There is no interpolation across missing outcomes or temporal extrapolation from future target rows. History intervals must finish by checkpoint, capped at the end of hour one; minute history is conservatively treated as hour-long if no hourly history is supplied.

## Validation

`node validate.ts --kit <kit>` tests schema, bounds, ordering, deterministic serialization, empty and sparse inputs, zero/missing anchors, unknown metadata, target exclusion and future/overlapping-history leakage. It also runs all four practice input files in isolated temporary directories under `/home/ubuntu/.hermes/cache/scratch/makefun-five/gta-validation/` and reports launch-level LOO versus persistence.

On the 37 comparable launch curves (851 observed launch-day hours), the selected model's LOO pinball loss is 0.4054 versus persistence 0.9297; 90% band coverage is 93.4% versus 62.4%, and median absolute log error corresponds to 82.4% versus 213.3% typical multiplicative miss. The console-only subgroup has just 8 launches (184 hours): loss 0.1993 versus 0.3226, coverage 99.5% versus 79.9%, and typical miss 29.6% versus 67.7%. These are in-sample selection diagnostics across folds, not the unavailable official server score.

| Bandwidth | Context | Metadata | LOO loss | Console loss |
| --- | --- | --- | --- | --- |
| 3 | No | No | 0.43677 | 0.27508 |
| 3 | No | Yes | 0.40945 | 0.23407 |
| 3 | Yes | Yes | 0.41621 | 0.22819 |
| 1.5 | Yes | Yes | 0.40541 | 0.19934 |

This broader launch set includes initially quiet categories followed by large global-unlock surges; its persistence loss need not match the published practice-target baseline. Whole-program tests on p00 through p03 check outputs and leakage, not target forecast accuracy: their held-out answers were neither read nor hand-written. On Node v22.22.3, measured cold CLI runs took about 0.31–0.43 seconds per case and produced about 2.5 KB each. Full LOO details and test logs remain outside git under the validation workspace. Small-sample tails, correlated franchise curves and an unprecedented target scale limit transferability; console subgroup coverage is visibly conservative.

## Data

See [DATA.md](DATA.md) for attribution and licence limitations. Kit observations and counts are not included in this repository.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s1kbd32j&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
