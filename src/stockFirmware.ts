// Generated from official Mutable Instruments Grids stock firmware WAV.
// This module decodes the bundled bootloader WAV into raw application bytes on demand.

import bundledStockFirmwareWavUrl from './assets/grids_1.0.wav?url';
import { OFFICIAL_GRIDS_STOCK_WAV_URL, OFFICIAL_GRIDS_FSK_OPTIONS, decodeGridsFirmwareWav } from './avrAudioBootloader';

const STOCK_GRIDS_FIRMWARE_SHA256 = '9b57784ac14b6ac7185392235d0614cfb2e77aebe2595339e628f03c69ba595b';
const STOCK_GRIDS_FIRMWARE_BYTES = 12672;

export interface BundledStockGridsFirmwareInfo {
  sourceWavUrl: string;
  bundledAssetUrl: string;
  sha256: string;
  byteLength: number;
}

let cachedStockFirmwareBinary: Uint8Array | null = null;

function decodeBundledStockFirmwareBytes(): Uint8Array {
  throw new Error('decodeBundledStockFirmwareBytes() is unavailable in synchronous mode. Use loadBundledStockGridsFirmwareBinary().');
}

export function getBundledStockGridsFirmwareInfo(): BundledStockGridsFirmwareInfo {
  return {
    sourceWavUrl: OFFICIAL_GRIDS_STOCK_WAV_URL,
    bundledAssetUrl: bundledStockFirmwareWavUrl,
    sha256: STOCK_GRIDS_FIRMWARE_SHA256,
    byteLength: STOCK_GRIDS_FIRMWARE_BYTES,
  };
}

export function getBundledStockGridsFirmwareBinary(): Uint8Array {
  if (!cachedStockFirmwareBinary) {
    return decodeBundledStockFirmwareBytes();
  }
  return cachedStockFirmwareBinary.slice();
}

export async function loadBundledStockGridsFirmwareBinary(): Promise<Uint8Array> {
  if (!cachedStockFirmwareBinary) {
    const response = await fetch(bundledStockFirmwareWavUrl);
    if (!response.ok) {
      throw new Error(`Failed to load bundled stock firmware WAV: HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    cachedStockFirmwareBinary = decodeGridsFirmwareWav(new Uint8Array(buffer), OFFICIAL_GRIDS_FSK_OPTIONS);
  }
  return cachedStockFirmwareBinary.slice();
}
