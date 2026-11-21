# csvreader21-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Iqbal17/csvreader21-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Iqbal17/csvreader21-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: it reads broken CSV files and answers exactly as the reference does — `{columns, rows, errors}` for every input — in about a third of the CPU time.

## How it works

`solve.js` keeps the reference's state machine exactly (BOM drop, stray CRs, unterminated quotes re-read as unquoted, quote junk, short/long rows, line counting inside quotes) but moves the common case onto native string operations:

- A record whose line holds no quote is read whole: its fields are sliced out with `indexOf` instead of a per-character loop. A lone CR inside it is dropped with a `stray_cr` error, exactly as the reference does; a final CR before the LF is the CRLF line ending.
- A record with a quote falls back to a field-by-field reader that slices whole spans between quotes instead of appending characters, and only walks a span character by character when it holds a line break (to count lines and fold CRLF / lone CR to LF).

`main.ts` is the house baseline's driver, kept as the kit directs: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## Measured speed

On the kit's 6-case practice set (about 10.2 MB of CSV), Node 22 with `--no-incremental-marking`, median of 10 runs:

| reader | time | vs reference |
| --- | --- | --- |
| csv-reader 1.0.0 (reference) | 444 ms | 1.00x |
| v1 of this entry | 172 ms | 2.58x |
| v2 (this commit) | 135 ms | 3.29x |

Correctness: the entry's answers match the reference on all 6 practice cases (verified with the kit's own scorer: `passed: 1, cases_passed: 6/6`), and on 6,004 differential fuzz cases against the reference (targeted edge cases plus random broken CSV), with zero mismatches.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=er6h345b&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
