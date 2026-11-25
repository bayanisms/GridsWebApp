import { readFileSync } from 'node:fs';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  GRIDS_WAV_OUTPUT_SAMPLE_RATE,
  patchGridsNodesInFirmware,
} from '../src/avrAudioBootloader';
import { FALLBACK_FACTORY_NODES } from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFirmware = decodeGridsFirmwareWav(stockWav);
const reencodedStock = encodeGridsFirmwareWav(stockFirmware);
const header = new DataView(
  reencodedStock.buffer,
  reencodedStock.byteOffset,
  reencodedStock.byteLength,
);

assert(GRIDS_WAV_OUTPUT_SAMPLE_RATE === 40_000, 'export must use Mutable stock sample rate');
assert(header.getUint32(24, true) === 40_000, 'WAV must declare 40 kHz');
assert(header.getUint16(22, true) === 1, 'WAV must be mono');
assert(header.getUint16(34, true) === 16, 'WAV must be 16-bit PCM');
assert(header.getUint32(28, true) === 80_000, 'invalid 40 kHz PCM byte rate');
assert(
  reencodedStock.length === stockWav.length,
  `stock re-encode length differs: ${reencodedStock.length} != ${stockWav.length}`,
);
for (let i = 0; i < stockWav.length; i += 1) {
  assert(
    reencodedStock[i] === stockWav[i],
    `stock re-encode is not byte-exact at WAV byte ${i}`,
  );
}

// A changed map must retain the exact same known-working container and framing.
const changedNode = Array.from({ length: 96 }, (_, index) => (index * 37 + 11) & 0xff);
const patched = patchGridsNodesInFirmware(
  stockFirmware,
  FALLBACK_FACTORY_NODES,
  [{ nodeIndex: 4, replacementNode: changedNode }],
).firmware;
const patchedWav = encodeGridsFirmwareWav(patched);
const decodedPatched = decodeGridsFirmwareWav(patchedWav);
assert(decodedPatched.length === patched.length, 'patched firmware round-trip length mismatch');
for (let i = 0; i < patched.length; i += 1) {
  assert(decodedPatched[i] === patched[i], `patched firmware mismatch at ${i}`);
}

console.log(JSON.stringify({
  status: 'ok',
  sampleRate: header.getUint32(24, true),
  channels: header.getUint16(22, true),
  bitsPerSample: header.getUint16(34, true),
  stockByteExact: true,
  stockWavBytes: stockWav.length,
  patchedWavBytes: patchedWav.length,
  firmwareBytes: stockFirmware.length,
}, null, 2));
