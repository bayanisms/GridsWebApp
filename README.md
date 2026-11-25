# GridsWebApp

A browser-based Mutable Instruments Grids editor, sequencer, and firmware patch/export tool built with React, TypeScript, and Vite.

## What it does

GridsWebApp combines four workflows in one UI:

- Live X/Y morphing across factory Grids drum-map nodes
- 32-step XOX pattern editing with per-step velocity
- Browser playback using an AudioContext-based lookahead scheduler
- Stock firmware patching/export for Grids-compatible lookup table updates

## Core features

### 1. Grids node morphing
- X/Y knobs are firmware map coordinates (same as `settings` after `~adc.Read8()`)
- Full 25-node bank lives in browser memory; dirty step edits commit into every node contributing to the current morph

### 2. Step sequencer
- 32-step kick/snare/hihat programming
- Per-step enable + velocity (exported to node levels)
- Step colors show hardware outcome at the current Density/Chaos:
  - solid = stable (fires even with Chaos 0)
  - amber dashed = chaos-sensitive (needs this bar’s random boost)
  - faint hatch = programmed but silent

### 3. Density and Chaos (hardware model)
- **Density 0 = no notes, 255 = densest** (firmware `threshold = ~density`)
- **Chaos 0 = none, 255 = max** bar-hold randomness
- Chaos matches `EvaluateDrums`: at step 0 of each bar, each instrument gets
  `part_perturbation = (Random::GetByte() * (chaos >> 2)) >> 8` and holds it for 32 steps
- Playback re-rolls that boost every bar; UI classifies steps without rolling
- As on stock firmware, Chaos also boosts cleared (zero-level) steps. At high Density,
  those steps can fire; turn Chaos to 0 to keep cleared steps silent.
- Per-step Chance is encoded into each step's map level against the current FILL/Chaos settings. It is
  quantized to the nearest achievable hardware rate and correlated across each instrument's 32-step bar
  because stock Grids rolls one Chaos boost per instrument per bar, not independent RNG per step.
- Velocity controls map level/accent only at 100% Chance. Below 100%, Chance owns Grids' single map byte,
  so Velocity is deliberately locked instead of changing the requested probability.

### 4. Audio playback
- WebAudio drum synth (local 808-style engine)
- AudioContext lookahead scheduler
- Per-channel level controls plus master output

### 5. Firmware tooling
- Loads bundled stock firmware baseline from `src/assets/grids_1.0.wav`
- Verifies stock integrity, patches only changed drum-map nodes, round-trips WAV encode/decode
- Exports patched WAV, full `lookup_tables.py`, and JSON editor state

### 6. Browser persistence
- Editable bank + knobs saved in `localStorage` (`gridswebapp.browserBank.v3`)

## Project structure

- `src/App.tsx` — app composition, bank commit, import/export wiring
- `src/grids.ts` — data model, density/chaos, pattern gen
- `src/playbackScheduler.ts` — hardware-like bar chaos + lookahead transport
- `src/avrAudioBootloader.ts` — FSK WAV decode/encode/patch
- `src/firmwareExport.ts` — JSON snapshot + Python lookup table builders
- `src/browserPersistence.ts` — localStorage bank/session
- `src/importExport.ts` — JSON import normalization
- `src/editorPanels.tsx` / `src/components.tsx` — UI panels and knobs/map
- `src/audio808.ts` — browser drum voices
- `src/stockFirmware.ts` — bundled stock WAV loader
- `scripts/verify_*.ts` — regression checks

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
npm test
```

## Firmware export notes

- stock firmware decode from the bundled asset
- SHA-256 integrity check against bundled metadata
- binary validation and bootloader boundary (`0x7000`)
- WAV encode/decode round-trip before download

## Status

Purpose-built XOX Grids editor with full-bank XY editing, hardware-parity density/chaos, and safe firmware export. Per-step Velocity remains programmable; Chaos matches global hardware bar-hold boost only.

## Prepare a GitHub source upload

Requires Node.js 22.12 or newer and Python 3 for source packaging.

```bash
npm ci
npm test
npm run lint
npm run build
npm run prepare:github
```

Extract `release/GridsWebApp-source.zip` into an empty folder and upload the
extracted files (including `.github`, `.gitignore`, and `.gitattributes`) to a new
GitHub repository. The archive contains the current source, dependencies lockfile,
checks, and Pages workflow. It excludes existing Git history, remote configuration,
local tool state, credentials folders, logs, build output, dependencies, old QA
reports, and optional upstream hardware CAD files. It does not need local vendor
checkouts. The packager checks included contents for user-specific paths, private
network addresses, common credential formats, and local machine identifiers, and
writes ZIP entries without local timestamps or ownership metadata.

Use this fresh archive for the upload: ignore rules do not remove files already
tracked in an older repository or personal information in old commits. Review any
future source additions before publishing; the automated scan is a useful check,
not a guarantee against every possible secret format.

For GitHub Pages, select **GitHub Actions** as the Pages deployment source.
The included workflow deploys pushes to `main` or `master` and can also be run manually.
The relative asset base supports project repository URLs.
