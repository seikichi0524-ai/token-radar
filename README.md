# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar that ranks token-less protocols by fitted value at issuance, built from a fixed DefiLlama snapshot (758 protocols). Two models do the work, both fitted on the snapshot itself and both validated out of sample. The value model (radar-4) prices a launch by least squares in log space on the snapshot's own already-issued protocols — 92 comparables that pass the board's own "a protocol in its own right" reading. It found that value grows far slower than TVL (a size-curve slope of 0.376, not 1 — among issued protocols the median market value is 0.87x TVL for the smallest third of TVL, 0.25x for the middle third, 0.08x for the largest), that the 7-day change carries no usable pricing signal (pre-launch TVL spikes are usually rented, points-driven capital; the term is dropped by a sign rule), and that age and chain reach adjust the curve slightly. Its out-of-sample median pricing error is a x3.49 typical miss, against x4.48 for the hand-set radar-2 and x4.74 for a naive flat multiple. The issuance model is a logistic regression over the snapshot's 290 clearly-labelled protocols that scores P(token) — the share of like-shaped protocols that have already issued — with a cross-validated AUC of 0.71 and calibrated deciles. The board ranks by value at issuance, as the brief asks; P(token) rides beside every value, low-issuance rows are dimmed and tagged, and a glance table up top combines the two into expected value for the ten rows where they combine highest.

Board edition 4 is the edition that removed things on evidence. The per-family offsets radar-3 carried (curators up, lending down) flattered themselves on the canonical folds (0.515) but lost under 20 repetitions of 5-fold cross-validation (0.551 against 0.527 without them, worse at every shrinkage level tried), so they are gone, and the dashboard publishes the ablation — including the paired-bootstrap interval that puts the remaining model's edge over a bare power law at indistinguishable-from-zero, and the caveat that the spec was chosen on the same resamples it is scored on. Verdicts were rebuilt for the same reason: judging plans against a band edge collapses to "skip everything" once uncertainty is honest, so each plan is now read on expected profit — P(token) x a declared 10% community share x value, pro-rata to capital, minus gas at 2025 levels and a 4%-a-year opportunity cost on realistic capital ($250–$5,000 by TVL tier) — with P(profit) integrated over the fit's own out-of-sample residuals, the smallest capital that breaks even in expectation, and, where the expected yield per dollar sits under the opportunity-cost rate, the plain statement that no size breaks even. Every row also carries two ranges that are never merged: a bootstrap band (fit uncertainty, 200 seeded refits) and a prediction interval from the folds' residuals (÷9 to x15), because launches land in the second, not the first. An interactive capital scaler and a "model vs TVL" strip from earlier drafts were cut: with opportunity cost in the arithmetic, the per-row break-even capital carries the same information without the controls.

What the board holds, as before: every row's farm plan is written to 2025 practice (an established wallet funded from an exchange, time-weighted positions held across weekly snapshots, varied amounts on varying weekdays, a points ledger, an eligibility-checked claim inside its window); rows carry watch notes derived from their own fields (allocator TVL, a hot or collapsing week, missing or very young listing age); and the whole universe is audited — all 342 token-less protocols are accounted for, 198 ranked and the other 144 named with the reason each was set aside. The model panel states the blind spot plainly: revenue, float and unlock design, and funding are what practitioners weight most, and none of them is among the snapshot's ten fields — every value here is what the market has historically paid for this much TVL, of this age and sprawl.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=./output node main.ts --input ./snapshot.json
```

To reproduce the models' fitted constants, their out-of-sample validation (including the offsets ablation, the per-term ablation and the issuance calibration), the bootstrap bands, the issuance weights and the residual distribution (written to lib/bands.ts, lib/ptoken.ts and lib/residuals.ts):

```sh
node tools/fit.mjs ./snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
