# Frozen validation protocol

Declared before candidate scoring in this native Codex session. Existing published
baseline scores were supplied in the delegation; no official target answers or
per-case official losses are used. `legacy.ts` preserves the accepted implementation
from d8ed01e, credited to the previous recorded agent.

## Data and folds

Use supplied comparable launches only, deduplicated by normalized title and launch
date, with title identity excluded from every outer training set. Verify matching
comparable inputs across p00..p03, UTC midnight day_start, hourly spacing, duplicate
rows, title/date uniqueness and pre-checkpoint history availability. Missing outcomes
remain missing. Platform and unlock features stop before Source/Tier/Research notes;
only generic keyword flags are parsed, never numerical outcome summaries.

Selection titles launch before 2025-01-01. Audit titles launch on/after that date;
their outcomes must not be scored until one configuration is frozen. Minimum
chronological training size is six distinct titles. Rolling-origin folds train only
on earlier day_start dates; residual calibration additionally uses only launches
earlier than each calibration title, with at least four prior titles. Same-date
titles cannot train each other. Retrospective title-group LOO is explicitly separate:
selection LOO uses only selection titles; final all-title LOO may use future titles.
Every title has equal weight in summaries and bootstrap, regardless of observed hours.

## Bounded selection grid

Six candidates, all anchored to observed hour one, no game-specific branches:

1. Weighted empirical log-curve quantiles: console mismatch weight 0.08, anchor log bandwidth 2.
2. Same with console mismatch weight 0.2, bandwidth 2.
3. Same with console mismatch weight 0.08, bandwidth 4.
4. Robust log location plus chronological held-title residual quantiles, mismatch 0.08, bandwidth 2.
5. Same with mismatch 0.2, bandwidth 2.
6. Same with mismatch 0.08, bandwidth 4.

All candidates use rolling/early-access mismatch multiplier 0.6 each. Empirical
quantiles use weighted midpoint interpolation; residuals pool adjacent hours +/-2,
each calibration title receiving total weight equal to its analogue weight. No
arbitrary normal-kernel broadening. Sparse calibration falls back to curve quantiles;
no records falls back to the original persistence distribution. Robust location is
a weighted Huber mean with threshold 0.7 and a half-title persistence prior.

Choose the candidate with minimum selection console LOO loss among those whose
selection overall LOO and chronological losses are each <=1.03 times legacy.
If none qualify, freeze the minimum console-loss candidate for an explicitly failed
gate report. No more configurations or audit-driven retuning.

## Improvement gate and uncertainty

After freezing, score audit chronological and retrospective folds once and retain
every candidate's selection results, including failures. Accept only if final
all-title console LOO loss is at least 10% lower than legacy, overall LOO and
chronological loss each <=1.03 times legacy, and audit chronological loss <=1.03
times legacy. Paired launch bootstrap (5,000 draws, deterministic seed) reports
95% intervals for loss differences and relative changes on every aggregate,
especially small console subgroups. Reject if a chronological or overall loss
difference interval lies wholly above zero. A console benefit interval crossing
zero must be disclosed as inconclusive, even if the point-estimate gate passes.

Report doubled log pinball loss per quantile, 90% coverage, median absolute log
miss transformed as 100*expm1(error), mean multiplicative and log interval width,
and title counts. Median miss differs from legacy validate.ts's mean-log metric;
also report the latter to reproduce earlier numbers. Bootstrap units are titles,
never hours. No rank/top-20 guarantee follows from these historical diagnostics.

If the gate fails, retain the original default. Candidate source and rejection
evidence remain reproducible. Official accepted loss 0.189076 and coverage 0.98913
are supplied coordinator context, not remeasured here and not selection inputs.

## Provenance

The person's verbatim opening prompt is externally stored at
`/home/ubuntu/.hermes/cache/scratch/makefun-five/user-request.txt`; it requests
account connection and bounty entry across multiple campaigns. The person's latest
steering is “intinya harus top rank minimal 20 aja , bisa gak? disemua campaign”.
This model/validation task and all methodological requirements are coordinator
delegation, not the person's opening prompt. This worker performs offline coding
only; coordinator independently reviews and decides submission.
