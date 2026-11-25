/**
 * Hardware-faithful simulation of avr_audio_bootloader FSK Decoder
 * as used by grids/bootloader/bootloader.cc
 */
import { readFileSync } from 'node:fs';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  patchGridsNodesInFirmware,
} from '../src/avrAudioBootloader';
import { FALLBACK_FACTORY_NODES } from '../src/grids';

const kPause = 16;
const kOne = 8;
const kZero = 4;
const kOneZeroThreshold = (kOne + kZero) >> 1; // 6
const kPauseOneThreshold = (kPause + kOne) >> 1; // 12
const kMaxSyncDuration = 500;
const kPreambleSize = 32;
const kPacketSize = 128;

type DecoderState =
  | 'SYNCING'
  | 'DECODING_PACKET'
  | 'PACKET_RECEIVED'
  | 'ERROR_SYNC'
  | 'END_OF_TRANSMISSION';

function crc32GaryBrown(buf: Uint8Array): number {
  let crc = 0 ^ 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  for (let i = 0; i < buf.length; i += 1) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pcmFromWav(bytes: Uint8Array): { sampleRate: number; samples: Int16Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  const n = view.getUint32(40, true) / 2;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = view.getInt16(44 + i * 2, true);
  return { sampleRate, samples };
}

/** Sample the player's held DAC output at the bootloader's fixed 40 kHz timer. */
function sampleAtBootloaderRate(
  samples: Int16Array,
  sourceRate: number,
  phase = 0.5,
): Int16Array {
  if (sourceRate === 40_000) return samples;
  const length = Math.floor((samples.length * 40_000) / sourceRate);
  const output = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = Math.min(
      samples.length - 1,
      Math.floor(((i + phase) * sourceRate) / 40_000),
    );
    output[i] = samples[sourceIndex];
  }
  return output;
}

function simulate(samples: Int16Array) {
  let previousSample = false;
  let duration = 0;
  let swallow = 4;
  let state: DecoderState = 'SYNCING';
  let expectedSymbols = 0xff;
  let preambleRemaining = kPreambleSize;
  let syncBlankSize = 0;
  let symbolCount = 0;
  let packetSize = 0;
  let packetCount = 0;
  const packet = new Uint8Array(kPacketSize + 4);

  let packetsOk = 0;
  let packetsCrcFail = 0;
  let syncErrors = 0;
  let eot = false;
  const okCrcs: number[] = [];

  const sync = () => {
    previousSample = false;
    duration = 0;
    swallow = 4;
    state = 'SYNCING';
    syncBlankSize = 0;
    expectedSymbols = 0xff;
    preambleRemaining = kPreambleSize;
  };

  const parseSyncHeader = (symbol: number) => {
    if (!((1 << symbol) & expectedSymbols)) {
      state = 'ERROR_SYNC';
      return;
    }
    switch (symbol) {
      case 2:
        syncBlankSize += 1;
        if (syncBlankSize >= kMaxSyncDuration && packetCount) {
          state = 'END_OF_TRANSMISSION';
          return;
        }
        expectedSymbols = (1 << 0) | (1 << 1) | (1 << 2);
        preambleRemaining = kPreambleSize;
        break;
      case 1:
        expectedSymbols = 1 << 0;
        preambleRemaining -= 1;
        break;
      case 0:
        expectedSymbols = 1 << 1;
        preambleRemaining -= 1;
        break;
      default:
        break;
    }
    if (preambleRemaining === 0) {
      state = 'DECODING_PACKET';
      packetSize = 0;
      packet[0] = 0;
      symbolCount = 0;
    }
  };

  const pushSymbol = (symbol: number) => {
    switch (state) {
      case 'SYNCING':
        parseSyncHeader(symbol);
        break;
      case 'DECODING_PACKET':
        if (symbol === 2) {
          state = 'ERROR_SYNC';
        } else {
          packet[packetSize] |= symbol;
          symbolCount += 1;
          if (symbolCount === 8) {
            symbolCount = 0;
            packetSize += 1;
            if (packetSize === kPacketSize + 4) {
              packetCount += 1;
              state = 'PACKET_RECEIVED';
            } else {
              packet[packetSize] = 0;
            }
          } else {
            packet[packetSize] <<= 1;
          }
        }
        break;
      default:
        break;
    }
  };

  const pushSample = (sample: boolean) => {
    if (previousSample === sample) {
      duration += 1;
    } else {
      previousSample = sample;
      let symbol = 0;
      if (duration >= kPauseOneThreshold) symbol = 2;
      else if (duration >= kOneZeroThreshold) symbol = 1;
      else symbol = 0;

      if (swallow) {
        symbol = 2;
        swallow -= 1;
      }
      pushSymbol(symbol);
      duration = 0;
    }
    return state;
  };

  // Match bootloader: sample at 40kHz, digital threshold on audio
  // Use mid-level threshold (positive => high)
  for (let i = 0; i < samples.length; i += 1) {
    const digital = samples[i] >= 0;
    const st = pushSample(digital);

    if (st === 'PACKET_RECEIVED') {
      const data = packet.slice(0, kPacketSize);
      const expected =
        ((packet[kPacketSize] << 24) |
          (packet[kPacketSize + 1] << 16) |
          (packet[kPacketSize + 2] << 8) |
          packet[kPacketSize + 3]) >>>
        0;
      const actual = crc32GaryBrown(data);
      if (actual === expected) {
        packetsOk += 1;
        okCrcs.push(actual);
      } else {
        packetsCrcFail += 1;
      }
      sync();
    } else if (st === 'ERROR_SYNC') {
      syncErrors += 1;
      sync();
    } else if (st === 'END_OF_TRANSMISSION') {
      eot = true;
      break;
    }
  }

  return {
    packetsOk,
    packetsCrcFail,
    syncErrors,
    eot,
    packetCount,
    samples: samples.length,
  };
}

function run(label: string, wav: Uint8Array) {
  const parsed = pcmFromWav(wav);
  const bootloaderSamples = sampleAtBootloaderRate(parsed.samples, parsed.sampleRate);
  const result = simulate(bootloaderSamples);
  console.log(JSON.stringify({
    label,
    wavSampleRate: parsed.sampleRate,
    bootloaderSampleRate: 40_000,
    ...result,
  }, null, 2));
  return result;
}

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFw = decodeGridsFirmwareWav(stockWav);
const stockReenc = encodeGridsFirmwareWav(stockFw);

const node = [...FALLBACK_FACTORY_NODES[4]];
node[0] = 200;
const patched = patchGridsNodesInFirmware(stockFw, FALLBACK_FACTORY_NODES, [
  { nodeIndex: 4, replacementNode: node },
]).firmware;
const patchedWav = encodeGridsFirmwareWav(patched);

const r1 = run('stock_official_wav', stockWav);
const r2 = run('stock_js_reenc', stockReenc);
const r3 = run('patched_js', patchedWav);

const expectedPages = stockFw.length / 128;
console.log(JSON.stringify({
  expectedPages,
  allEot: r1.eot && r2.eot && r3.eot,
  allFull: r1.packetsOk === expectedPages && r2.packetsOk === expectedPages && r3.packetsOk === expectedPages,
}, null, 2));
