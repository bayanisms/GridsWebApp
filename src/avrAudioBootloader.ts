// Reference implementation derived from Mutable Instruments' AVR audio bootloader:
// - eurorack/grids/makefile -> wav target parameters
// - avr_audio_bootloader/fsk/encoder.py -> packet framing and FSK symbols

const GRIDS_FLASH_PAGE_SIZE = 128;
// Grids' bootloader is linked at 0x7000, so audio updates must not write past
// the first 28 KiB of flash or they can overwrite the bootloader region.
const GRIDS_MAX_APPLICATION_BYTES = 0x7000;
const NODE_SIZE_BYTES = 96;
const NUM_NODES = 25;

const PATCH_METADATA_MAGIC = 'GRDSPCH1';

export interface GridsFskOptions {
  sampleRate: number;
  pausePeriod: number;
  onePeriod: number;
  zeroPeriod: number;
  packetSize: number;
  pageSize: number;
  blankDurationMs: number;
}

export interface FirmwareValidation {
  ok: boolean;
  message: string;
  warnings: string[];
}

export interface NodePatchRequest {
  nodeIndex: number;
  replacementNode: number[];
}

export interface NodePatchResult {
  firmware: Uint8Array;
  patchedOffsets: number[];
  warnings: string[];
}

export interface PatchMetadataOptions {
  pageSize?: number;
  maxApplicationBytes?: number;
}

/**
 * Exact timing used by Mutable's known-working shipping `grids_1.0.wav`.
 * Matching the released file is more reliable than adding custom timing or
 * sample-rate conversion in the browser.
 */
export const OFFICIAL_GRIDS_FSK_OPTIONS: GridsFskOptions = {
  sampleRate: 40000,
  pausePeriod: 16,
  onePeriod: 8,
  zeroPeriod: 4,
  packetSize: 128,
  pageSize: 128,
  blankDurationMs: 50,
};

/** Sample rate of Mutable's known-working Grids firmware WAV. */
export const GRIDS_WAV_OUTPUT_SAMPLE_RATE = 40_000;

const STOCK_WAV_PREAMBLE_RUNS = 2500;

export const OFFICIAL_GRIDS_STOCK_WAV_URL =
  'https://pichenettes.github.io/mutable-instruments-documentation/modules/grids/downloads/grids_1.0.wav';

export const GRIDS_MAX_APPLICATION_SIZE = GRIDS_MAX_APPLICATION_BYTES;

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatInt16Blocks(blocks: Int16Array[]): Int16Array {
  let totalLength = 0;
  for (const block of blocks) {
    totalLength += block.length;
  }

  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const block of blocks) {
    merged.set(block, offset);
    offset += block.length;
  }
  return merged;
}

function symbolsToPcm16(
  symbols: Uint8Array,
  options: GridsFskOptions,
  stateRef: { value: 1 | -1 },
): Int16Array {
  const durations = [options.zeroPeriod, options.onePeriod, options.pausePeriod];
  let totalSamples = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    totalSamples += durations[symbols[i]] ?? options.pausePeriod;
  }

  const pcm = new Int16Array(totalSamples);
  let index = 0;
  let state = stateRef.value;

  for (let i = 0; i < symbols.length; i += 1) {
    const duration = durations[symbols[i]] ?? options.pausePeriod;
    const amplitude = state > 0 ? 32767 : -32767;
    pcm.fill(amplitude, index, index + duration);
    state = state === 1 ? -1 : 1;
    index += duration;
  }

  stateRef.value = state;
  return pcm;
}

function encodeBlank(
  durationSeconds: number,
  options: GridsFskOptions,
  stateRef: { value: 1 | -1 },
): Int16Array {
  const symbolCount = Math.floor((durationSeconds * options.sampleRate) / options.pausePeriod) + 1;
  const symbols = new Uint8Array(symbolCount);
  symbols.fill(2);
  return symbolsToPcm16(symbols, options, stateRef);
}

function encodePacket(
  chunk: Uint8Array,
  options: GridsFskOptions,
  stateRef: { value: 1 | -1 },
): Int16Array {
  const packet = new Uint8Array(options.packetSize);
  packet.set(chunk);

  const checksum = crc32(packet);
  const bytes = new Uint8Array(4 + packet.length + 4);
  bytes.fill(0x55, 0, 4);
  bytes.set(packet, 4);
  bytes[4 + packet.length] = (checksum >>> 24) & 0xff;
  bytes[5 + packet.length] = (checksum >>> 16) & 0xff;
  bytes[6 + packet.length] = (checksum >>> 8) & 0xff;
  bytes[7 + packet.length] = checksum & 0xff;

  const symbols = new Uint8Array(bytes.length * 8);
  let cursor = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      symbols[cursor] = (bytes[i] >> bit) & 0x01 ? 1 : 0;
      cursor += 1;
    }
  }

  return symbolsToPcm16(symbols, options, stateRef);
}

function buildWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function encodeFirmwarePcm(
  firmware: Uint8Array,
  options: GridsFskOptions,
): Int16Array {
  const stateRef: { value: 1 | -1 } = { value: 1 };
  const blocks: Int16Array[] = [];

  // Match official FskEncoder.code(): 1s digital silence, then 1s pause symbols.
  blocks.push(new Int16Array(options.sampleRate));
  blocks.push(encodeBlank(1.0, options, stateRef));

  let data = firmware;
  if (data.length % options.pageSize !== 0) {
    const tail = options.pageSize - (data.length % options.pageSize);
    const padded = new Uint8Array(data.length + tail);
    padded.fill(0xff);
    padded.set(data);
    data = padded;
  }

  // Official encoder blanks only after a full flash page of packets
  // (page_size / packet_size). For Grids both are 128 → one blank per packet.
  const packetsPerPage = Math.max(1, Math.floor(options.pageSize / options.packetSize));
  let offset = 0;
  let packetsInPage = 0;
  while (offset < data.length) {
    const end = Math.min(offset + options.packetSize, data.length);
    blocks.push(encodePacket(data.slice(offset, end), options, stateRef));
    packetsInPage += 1;
    if (packetsInPage >= packetsPerPage) {
      blocks.push(encodeBlank(options.blankDurationMs * 0.001, options, stateRef));
      packetsInPage = 0;
    }
    offset = end;
  }

  // Trailing pause long enough for DECODER_STATE_END_OF_TRANSMISSION
  // (kMaxSyncDuration = 500 pause symbols). Official encoder / stock WAV use 1.0s.
  blocks.push(encodeBlank(1.0, options, stateRef));
  return concatInt16Blocks(blocks);
}

function classifyRunLength(
  runLength: number,
  options: GridsFskOptions,
): 0 | 1 | 2 {
  const durations: Array<[0 | 1 | 2, number]> = [
    [0, options.zeroPeriod],
    [1, options.onePeriod],
    [2, options.pausePeriod],
  ];

  let best: 0 | 1 | 2 = 2;
  let bestError = Number.POSITIVE_INFINITY;
  for (const [symbol, expected] of durations) {
    const error = Math.abs(runLength - expected);
    if (error < bestError) {
      bestError = error;
      best = symbol;
    }
  }
  return best;
}

function parseWavPcm16Mono(wavBytes: Uint8Array): { sampleRate: number; samples: Int16Array } {
  if (wavBytes.length < 44) {
    throw new Error('Invalid WAV: file too short.');
  }

  const view = new DataView(
    wavBytes.buffer,
    wavBytes.byteOffset,
    wavBytes.byteLength,
  );

  const readString = (offset: number, length: number) => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  };

  if (readString(0, 4) !== 'RIFF' || readString(8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV header.');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBytes.length) {
    const chunkId = readString(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > wavBytes.length) {
      break;
    }

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) {
    throw new Error('WAV data chunk not found.');
  }
  if (audioFormat !== 1) {
    throw new Error('Unsupported WAV format. Expected PCM audio.');
  }
  if (channels !== 1) {
    throw new Error(`Unsupported WAV channel count (${channels}). Expected mono.`);
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV bit depth (${bitsPerSample}). Expected 16-bit PCM.`);
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true);
  }

  return { sampleRate, samples };
}

function decodeSymbolsFromPcm(samples: Int16Array, options: GridsFskOptions): Uint8Array {
  const threshold = 2048;
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }
  if (start >= samples.length) {
    throw new Error('No FSK signal found in WAV.');
  }

  const symbols: number[] = [];
  let sign = samples[start] >= 0 ? 1 : -1;
  let runLength = 0;

  for (let i = start; i < samples.length; i += 1) {
    const sample = samples[i];
    if (Math.abs(sample) < threshold) {
      continue;
    }
    const currentSign = sample >= 0 ? 1 : -1;
    if (currentSign === sign) {
      runLength += 1;
      continue;
    }

    if (runLength > 0) {
      symbols.push(classifyRunLength(runLength, options));
    }
    sign = currentSign;
    runLength = 1;
  }

  if (runLength > 0) {
    symbols.push(classifyRunLength(runLength, options));
  }

  let preambleLength = 0;
  while (preambleLength < symbols.length && symbols[preambleLength] === 2) {
    preambleLength += 1;
  }

  if (preambleLength >= STOCK_WAV_PREAMBLE_RUNS) {
    return Uint8Array.from(symbols.slice(preambleLength));
  }

  return Uint8Array.from(symbols);
}

function splitSymbolPackets(symbols: Uint8Array, options: GridsFskOptions): Uint8Array[] {
  const expectedPacketBits = (4 + options.packetSize + 4) * 8;
  const packets: Uint8Array[] = [];

  for (let start = 0; start + expectedPacketBits <= symbols.length; ) {
    const candidate = symbols.slice(start, start + expectedPacketBits);
    const bytes = new Uint8Array(expectedPacketBits / 8);
    for (let i = 0; i < bytes.length; i += 1) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value << 1) | (candidate[i * 8 + bit] ? 1 : 0);
      }
      bytes[i] = value;
    }

    if (
      bytes[0] === 0x55 &&
      bytes[1] === 0x55 &&
      bytes[2] === 0x55 &&
      bytes[3] === 0x55
    ) {
      const dataStart = 4;
      const dataEnd = dataStart + options.packetSize;
      const data = bytes.slice(dataStart, dataEnd);
      const expectedCrc =
        (bytes[dataEnd] << 24) |
        (bytes[dataEnd + 1] << 16) |
        (bytes[dataEnd + 2] << 8) |
        bytes[dataEnd + 3];
      const actualCrc = crc32(data);
      if ((expectedCrc >>> 0) === actualCrc) {
        packets.push(data);
        let nextStart = start + expectedPacketBits;
        while (nextStart < symbols.length && symbols[nextStart] === 2) {
          nextStart += 1;
        }
        start = nextStart;
        continue;
      }
    }

    start += 1;
  }

  return packets;
}

function decodePacketsFromSymbols(symbols: Uint8Array, options: GridsFskOptions): Uint8Array {
  const packets = splitSymbolPackets(symbols, options);

  if (packets.length === 0) {
    throw new Error('No valid packets decoded from stock firmware WAV.');
  }

  const merged = new Uint8Array(packets.length * options.packetSize);
  packets.forEach((packet, index) => {
    merged.set(packet, index * options.packetSize);
  });
  return merged;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function createPatchMetadataBlock(
  payload: unknown,
  pageSize: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const magic = encoder.encode(PATCH_METADATA_MAGIC);

  const headerSize = magic.length + 1 + 4 + 4;
  const rawLength = headerSize + payloadBytes.length;
  const paddedLength = Math.ceil(rawLength / pageSize) * pageSize;
  const block = new Uint8Array(paddedLength);
  block.fill(0xff);

  let offset = 0;
  block.set(magic, offset);
  offset += magic.length;
  block[offset] = 1;
  offset += 1;

  const view = new DataView(block.buffer);
  view.setUint32(offset, payloadBytes.length, true);
  offset += 4;
  view.setUint32(offset, crc32(payloadBytes), true);
  offset += 4;
  block.set(payloadBytes, offset);
  return block;
}

function toNodeBytes(node: number[]): Uint8Array {
  if (node.length !== NODE_SIZE_BYTES) {
    throw new Error(`Node data must be ${NODE_SIZE_BYTES} bytes.`);
  }
  const out = new Uint8Array(node.length);
  for (let i = 0; i < node.length; i += 1) {
    out[i] = clampByte(node[i]);
  }
  return out;
}

function findSubarray(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0 || haystack.length < needle.length) {
    return -1;
  }

  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function buildFactoryNodeTable(factoryNodes: number[][]): Uint8Array {
  const table = new Uint8Array(NUM_NODES * NODE_SIZE_BYTES);
  for (let nodeIndex = 0; nodeIndex < NUM_NODES; nodeIndex += 1) {
    table.set(toNodeBytes(factoryNodes[nodeIndex]), nodeIndex * NODE_SIZE_BYTES);
  }
  return table;
}

function locateFactoryNodeTable(firmware: Uint8Array, factoryNodes: number[][]): number {
  const expectedTable = buildFactoryNodeTable(factoryNodes);
  const firstOffset = findSubarray(firmware, expectedTable, 0);
  if (firstOffset < 0) {
    throw new Error('Could not locate the contiguous factory node table in stock firmware image.');
  }

  const secondOffset = findSubarray(firmware, expectedTable, firstOffset + 1);
  if (secondOffset >= 0) {
    throw new Error(
      `Factory node table appears multiple times; refusing ambiguous patch at 0x${firstOffset.toString(16)}.`,
    );
  }

  return firstOffset;
}

export function decodeGridsFirmwareWav(
  wavBytes: Uint8Array,
  options: GridsFskOptions = OFFICIAL_GRIDS_FSK_OPTIONS,
): Uint8Array {
  const { sampleRate, samples } = parseWavPcm16Mono(wavBytes);
  if (sampleRate <= 0) {
    throw new Error(`Unexpected sample rate (${sampleRate} Hz).`);
  }

  // Symbol periods are canonical 40 kHz run lengths. Scale the expected run
  // Scale canonical 40 kHz run lengths when inspecting a WAV at another rate.
  const scale = sampleRate / options.sampleRate;
  const decodeOptions: GridsFskOptions = {
    ...options,
    sampleRate,
    pausePeriod: options.pausePeriod * scale,
    onePeriod: options.onePeriod * scale,
    zeroPeriod: options.zeroPeriod * scale,
  };
  const symbols = decodeSymbolsFromPcm(samples, decodeOptions);
  return decodePacketsFromSymbols(symbols, decodeOptions);
}

export function patchGridsNodesInFirmware(
  firmware: Uint8Array,
  factoryNodes: number[][],
  patches: NodePatchRequest[],
): NodePatchResult {
  if (factoryNodes.length < NUM_NODES) {
    throw new Error('Factory node table is incomplete.');
  }

  const out = firmware.slice();
  const nodeTableOffset = locateFactoryNodeTable(firmware, factoryNodes);
  const patchedOffsets: number[] = [];
  const warnings: string[] = [];

  for (const patch of patches) {
    if (patch.nodeIndex < 0 || patch.nodeIndex >= NUM_NODES) {
      throw new Error(`Node index ${patch.nodeIndex} is out of range.`);
    }

    const replacement = toNodeBytes(patch.replacementNode);
    const patchOffset = nodeTableOffset + patch.nodeIndex * NODE_SIZE_BYTES;
    out.set(replacement, patchOffset);
    patchedOffsets.push(patchOffset);
  }

  return { firmware: out, patchedOffsets, warnings };
}

export function appendPatchMetadataToFirmware(
  firmware: Uint8Array,
  metadataPayload: unknown,
  options: PatchMetadataOptions = {},
): Uint8Array {
  const pageSize = options.pageSize ?? GRIDS_FLASH_PAGE_SIZE;
  const maxApplicationBytes = options.maxApplicationBytes ?? GRIDS_MAX_APPLICATION_BYTES;
  const metadataBlock = createPatchMetadataBlock(metadataPayload, pageSize);

  const out = new Uint8Array(firmware.length + metadataBlock.length);
  out.set(firmware);
  out.set(metadataBlock, firmware.length);

  if (out.length > maxApplicationBytes) {
    throw new Error(
      `Patched firmware (${out.length} bytes) exceeds Grids application limit (${maxApplicationBytes} bytes).`,
    );
  }

  return out;
}

export function validateGridsFirmwareBinary(firmware: Uint8Array): FirmwareValidation {
  if (firmware.length === 0) {
    return { ok: false, message: 'Firmware file is empty.', warnings: [] };
  }

  if (firmware.length > GRIDS_MAX_APPLICATION_BYTES) {
    return {
      ok: false,
      message: `Firmware is ${firmware.length} bytes, larger than Grids application space (${GRIDS_MAX_APPLICATION_BYTES} bytes).`,
      warnings: [],
    };
  }

  const warnings: string[] = [];

  let allFF = true;
  let allZero = true;
  for (let i = 0; i < firmware.length; i += 1) {
    const byte = firmware[i];
    if (byte !== 0xff) {
      allFF = false;
    }
    if (byte !== 0x00) {
      allZero = false;
    }
  }

  if (allFF || allZero) {
    return {
      ok: false,
      message: 'Firmware image appears blank or invalid (all 0x00/0xFF).',
      warnings: [],
    };
  }

  if (firmware.length < 8192) {
    warnings.push('Firmware is unusually small; verify this is a full Grids image.');
  }

  if (firmware.length % GRIDS_FLASH_PAGE_SIZE !== 0) {
    warnings.push(
      `Firmware size is not aligned to ${GRIDS_FLASH_PAGE_SIZE}-byte pages; encoder will pad with 0xFF.`,
    );
  }

  if (firmware[0] === 0xff && firmware[1] === 0xff) {
    warnings.push('Reset vector looks suspicious (0xFFFF).');
  }

  return {
    ok: true,
    message: `Firmware image accepted (${firmware.length} bytes).`,
    warnings,
  };
}

export function encodeGridsFirmwareWav(
  firmware: Uint8Array,
  options: GridsFskOptions = OFFICIAL_GRIDS_FSK_OPTIONS,
): Uint8Array {
  const pcm = encodeFirmwarePcm(firmware, options);
  return buildWav(pcm, options.sampleRate);
}
