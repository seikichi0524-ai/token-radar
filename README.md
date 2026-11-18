# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar that ranks token-less protocols by implied value, built from a fixed DefiLlama snapshot (758 protocols). The valuation model (radar-3) is not hand-set: its coefficients are fitted by least squares in log space on the snapshot's own already-issued protocols — 92 comparables that pass the board's own "a protocol in its own right" reading — and validated out of sample four ways (3-fold, leave-one-out, time splits in both directions, and as a ranking). The fit found that value grows far slower than TVL (a size-curve slope of 0.395, not 1 — external launch evidence, from EigenLayer's 0.065x to ether.fi's 0.13x mcap/TVL, agrees), that the 7-day change carries no usable pricing signal (pre-launch TVL spikes are usually rented, points-driven capital; the term is dropped by a sign rule), and that category-family offsets, age and chain reach adjust the curve modestly. The fitted model's out-of-sample median pricing error is a x3.23 typical miss, against x4.48 for the hand-set model it replaced and x4.74 for a naive flat multiple.

This edition keeps that fit byte-for-byte — a robust Huber + empirical-Bayes challenger was specified in advance, run under a pre-registered adoption rule, and failed it, so it did not ship (the experiment is reproducible in tools/fit.mjs) — and rebuilds everything around the fit. Every board row now carries a bootstrap value band and rank range from 200 seeded refits. Every farm plan is written to 2025 practice (an established wallet funded from an exchange, time-weighted positions held across weekly snapshots, varied amounts on varying weekdays, a points ledger, an eligibility-checked claim inside its window) at 2025 gas levels, and is netted to a break-even launch value under one declared assumption (a launch distributes 10% of its value to farmers, pro-rata to capital kept in the protocol), ending in a farm / thin / skip verdict for a small wallet. The dashboard also audits the whole universe: all 342 token-less protocols are accounted for — 198 ranked, and the other 144 named with the reason each was set aside. The model panel states the model's blind spot plainly: revenue, float and unlock design, and funding are what practitioners weight most, and none of them is among the snapshot's ten fields — every value here is what the market has historically paid for this much TVL of this type and age.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=./output node main.ts --input ./snapshot.json
```

To reproduce the model's fitted constants, its out-of-sample validation, the challenger experiment and the bootstrap bands (written to lib/bands.ts):

```sh
node tools/fit.mjs ./snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
