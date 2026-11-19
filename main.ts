// Token Radar (radar-4 fit, board edition 4) — entry point. Node 22,
// standard library only.
//
// Reads the sealed snapshot, scores every selected pre-token protocol with
// lib/model.ts — a valuation fitted on the snapshot's own issued protocols,
// not hand-set — then writes into the output directory:
//   board.json    the ranked board (watchlist fully covered, 100+ rows)
//   data.js       the same board in the dashboard's compact form
//   dashboard/    a copy of this repo's dashboard/
//   screenshots/  a copy of this repo's screenshots/
//   dossier.json  buildDossier output from vendor/makefun-board.ts
//
// The run is deterministic: no clock, no randomness, no network. Sorting is
// by implied value with a slug tie-break, so two runs write identical bytes.
// The fit itself is not re-run here: lib/model.ts carries the constants
// tools/fit.mjs produced from this same snapshot, and that script is in the
// repo so the numbers can be reproduced and checked.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf('--' + name);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write('token radar: ' + message + '\n');
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail('no snapshot at ' + inputFile + ': pass --input <snapshot.json|directory>', 2);
}
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail('the model wrote a board the gate refuses: ' + issue, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length < 3) fail('dashboard/ holds ' + dashFiles.length + ' files: index.html, a .css and a .js are required', 1);
if (shots.length < 3) fail('screenshots/ holds ' + shots.length + ' images: hand in 3 (board, detail, filtered)', 1);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail('screenshots/' + name + ': names are letters, digits and . _ -, 1 to 128 characters', 1);
}

const dossier = buildDossier(outDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: DASHBOARD_CAPS,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const top = board[0];
process.stdout.write(
  'token radar: ' + snapshot.protocols.length + ' protocols, ' + snapshot.watchlist.length + ' watchlist, ' +
    board.length + ' rows scored (' + radar.early_size + ' early, ' + radar.live_size + ' live set aside)\n' +
    (top === undefined ? '' : 'token radar: top of the board is ' + top.name + ' at $' + top.implied_value_usd.toLocaleString('en-US') + ' implied\n') +
    'token radar: model ' + radar.model_version + ' (board edition ' + radar.board_edition + ') fitted on ' + radar.model.comps + ' issued comparables' +
    ' (out-of-sample median log error ' + radar.validation.fitted_median_log_err + ' vs ' +
    radar.validation.radar2_median_log_err + ' for the hand-set radar-2); ' +
    radar.audit.length + ' pre-token protocols audited off-board\n' +
    'token radar: wrote board.json, data.js, dashboard/ (' + dashFiles.length + ' files), screenshots/ (' +
    shots.length + ' images) and dossier.json (' + dossier.length + ' bytes)\n',
);
