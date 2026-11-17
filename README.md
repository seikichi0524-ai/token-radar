# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/seikichi0524-ai/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar that ranks token-less protocols by implied value, built from a fixed DefiLlama snapshot (758 protocols). Each protocol's implied value is its TVL scaled by a category multiple, a damped 7-day growth factor, a maturity factor from its listing age, a chain-spread factor and a log size factor. The board keeps every watchlist protocol and surfaces the highest implied values first, each with concrete farm steps. A static dashboard (dashboard/) renders the same board and recomputes every value in the browser.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=./output node main.ts --input ./snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
