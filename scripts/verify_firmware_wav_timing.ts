import { readFileSync } from 'node:fs';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  OFFICIAL_GRIDS_FSK_OPTIONS as opt,
} from '../src/avrAudioBootloader';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseSamples(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = view.getUint32(40, true);
  const samples = new Int16Array(dataSize / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(44 + i * 2, true);
  }
  return samples;
}

function parseSampleRate(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
}

function interPacketPauseSymbols(samples: Int16Array, sampleRate: number): number[] {
  const thr = 2048;
  let i = 0;
  while (i < samples.length && Math.abs(samples[i]) < thr) i += 1;
  const runs: number[] = [];
  if (i >= samples.length) return runs;
  let sign = samples[i] >= 0 ? 1 : -1;
  let len = 0;
  const lens: number[] = [];
  for (; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) < thr) continue;
    const s = samples[i] >= 0 ? 1 : -1;
    if (s === sign) {
      len += 1;
    } else {
      if (len > 0) lens.push(len);
      sign = s;
      len = 1;
    }
  }
  if (len > 0) lens.push(len);

  const scale = sampleRate / opt.sampleRate;
  const classify = (run: number) => {
    const errs = [
      Math.abs(run - opt.zeroPeriod * scale),
      Math.abs(run - opt.onePeriod * scale),
      Math.abs(run - opt.pausePeriod * scale),
    ];
    return errs.indexOf(Math.min(...errs)); // 0/1/2
  };
  const symbols = lens.map(classify);

  let idx = 0;
  while (idx < symbols.length && symbols[idx] === 2) idx += 1;
  const pauses: number[] = [];
  while (idx < symbols.length) {
    while (idx < symbols.length && symbols[idx] !== 2) idx += 1;
    let pause = 0;
    while (idx < symbols.length && symbols[idx] === 2) {
      pause += 1;
      idx += 1;
    }
    pauses.push(pause);
  }
  return pauses;
}

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFw = decodeGridsFirmwareWav(stockWav);
const reenc = encodeGridsFirmwareWav(stockFw);
const roundTrip = decodeGridsFirmwareWav(reenc);
const stockRate = parseSampleRate(stockWav);
const reencRate = parseSampleRate(reenc);

assert(stockRate === 40_000, `stock rate changed unexpectedly: ${stockRate}`);
assert(reencRate === stockRate, `export rate ${reencRate} must match stock ${stockRate}`);

assert(roundTrip.length === stockFw.length, 'round-trip length mismatch');
for (let i = 0; i < stockFw.length; i += 1) {
  assert(roundTrip[i] === stockFw[i], `round-trip byte mismatch at ${i}`);
}

const stockPauses = interPacketPauseSymbols(parseSamples(stockWav), stockRate);
const reencPauses = interPacketPauseSymbols(parseSamples(reenc), reencRate);

// Between packets (exclude final trailing pause)
const stockInter = stockPauses.slice(0, -1);
const reencInter = reencPauses.slice(0, -1);
const stockInterMode = stockInter[0];
const reencInterMode = reencInter[0];

assert(stockInter.every((p) => p === stockInterMode), 'stock inter-packet pause not uniform');
assert(reencInter.every((p) => p === reencInterMode), 'reenc inter-packet pause not uniform');

// Match the shipping WAV's known-working ~126 pause symbols (~50 ms) exactly.
assert(
  stockInterMode >= 120 && stockInterMode <= 130,
  `unexpected stock inter-packet pause ${stockInterMode}`,
);
assert(
  reencInterMode === stockInterMode,
  `exported inter-packet pause ${reencInterMode} != stock ${stockInterMode}`,
);
assert(
  reencInterMode >= 120 && reencInterMode <= 130,
  `expected stock ~50ms blank (~126 pause symbols), got ${reencInterMode}`,
);

// Trailing pause must exceed bootloader kMaxSyncDuration (500 symbols).
const reencTrail = reencPauses[reencPauses.length - 1];
assert(reencTrail >= 500, `trailing pause ${reencTrail} too short for EOT`);

assert(opt.blankDurationMs === 50, 'blankDurationMs must match the stock 50ms timing');

console.log(JSON.stringify({
  status: 'ok',
  stockInterPauseSymbols: stockInterMode,
  reencInterPauseSymbols: reencInterMode,
  reencTrailingPauseSymbols: reencTrail,
  stockSampleRate: stockRate,
  reencSampleRate: reencRate,
  stockDurationSec: +(parseSamples(stockWav).length / stockRate).toFixed(3),
  reencDurationSec: +(parseSamples(reenc).length / reencRate).toFixed(3),
  packets: stockFw.length / 128,
}, null, 2));
