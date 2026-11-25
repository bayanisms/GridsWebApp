import { readFileSync } from 'node:fs';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  GRIDS_WAV_OUTPUT_SAMPLE_RATE,
} from '../src/avrAudioBootloader';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFirmware = decodeGridsFirmwareWav(stockWav);
const reencoded = encodeGridsFirmwareWav(stockFirmware);

assert(GRIDS_WAV_OUTPUT_SAMPLE_RATE === 40_000, 'export must retain the stock 40 kHz rate');
assert(reencoded.length === stockWav.length, 'stock re-encode length mismatch');
for (let i = 0; i < stockWav.length; i += 1) {
  assert(reencoded[i] === stockWav[i], `stock WAV byte mismatch at ${i}`);
}

console.log(JSON.stringify({
  status: 'ok',
  stockWavBytes: stockWav.length,
  reencodedWavBytes: reencoded.length,
  firmwareBytes: stockFirmware.length,
  byteExact: true,
}, null, 2));
