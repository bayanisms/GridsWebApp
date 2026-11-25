import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  OFFICIAL_GRIDS_FSK_OPTIONS,
  patchGridsNodesInFirmware,
  validateGridsFirmwareBinary,
} from '../src/avrAudioBootloader';
import {
  FALLBACK_FACTORY_NODES,
  INSTRUMENTS,
  STEPS_PER_PATTERN,
  densityThreshold,
  makeStepCell,
  nodeDataFromPattern,
  isStepTriggered,
  createPatternFromProgrammedSteps,
  interpolationNodeIndicesFromXY,
  type PatternState,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function exportedLevel(cell: { level: number; velocity: number; active: boolean }): number {
  if (!cell.active) return 0;
  // Firmware map stores level only; velocity is browser audition gain.
  return Math.max(1, Math.min(255, Math.round(cell.level)));
}

// Density knobs are firmware-internal: 0 = silent, 255 = densest.
const densityAtProgramming = 128;
const silencingDensity = 32;
const manualKick = makeStepCell({
  active: true,
  density: densityAtProgramming,
  chaos: 0,
  strength: 'normal',
  velocity: 72,
  chaosChance: 100,
  generated: false,
});

assert(manualKick.active, 'manual hit should remain programmed');
assert(manualKick.velocity === 72, 'manual hit should save per-step velocity');
assert(manualKick.level > densityThreshold(densityAtProgramming), 'manual 100% hit must sit above density threshold');
assert(isStepTriggered(manualKick, densityAtProgramming, 0), 'manual hit should trigger at programming density with chaos 0');
assert(!isStepTriggered(manualKick, silencingDensity, 0), 'lowering density should hide/silence the same programmed hit');
assert(isStepTriggered(manualKick, densityAtProgramming, 255), 'full chaos should not break an already-triggering hit');

// At density 0, almost nothing fires; at 255, threshold is 0 so any level > 0 fires.
assert(densityThreshold(0) === 255, 'density 0 must map to max threshold (silent)');
assert(densityThreshold(255) === 0, 'density 255 must map to min threshold (densest)');
assert(!isStepTriggered(manualKick, 0, 0), 'density 0 should silence a normal programmed hit');
assert(isStepTriggered(manualKick, 255, 0), 'density 255 should fire a programmed hit');

const borderline = makeStepCell({
  active: true,
  density: 96,
  chaos: 255,
  strength: 'soft',
  level: densityThreshold(96) - 1,
  velocity: 96,
  generated: false,
});
assert(borderline.velocity === 96, 'borderline hit should save custom per-step velocity');
assert(!isStepTriggered(borderline, 96, 0), 'borderline hit should be hidden with chaos 0');
assert(isStepTriggered(borderline, 96, 255), 'full chaos should bring a borderline hit over threshold');

const pattern: PatternState = createPatternFromProgrammedSteps();
pattern.kick[0] = manualKick;
pattern.snare[5] = makeStepCell({ active: true, density: 144, chaos: 0, strength: 'accent', velocity: 80, chaosChance: 100, generated: false });
pattern.hihat[7] = makeStepCell({ active: true, density: 216, chaos: 0, strength: 'soft', velocity: 64, chaosChance: 100, generated: false });

assert(pattern.kick.length === STEPS_PER_PATTERN, 'kick track length mismatch');
assert(INSTRUMENTS.every((instrument) => pattern[instrument].length === STEPS_PER_PATTERN), 'all tracks should have 32 steps');

const nodeData = nodeDataFromPattern(pattern);
assert(nodeData.length === 96, `node data should be 96 bytes, got ${nodeData.length}`);
assert(nodeData[0] === exportedLevel(manualKick), 'firmware export must write programmed kick map level (not velocity-scaled)');
assert(nodeData[32 + 5] === exportedLevel(pattern.snare[5]), 'firmware export must write programmed snare map level (not velocity-scaled)');
assert(nodeData[64 + 7] === exportedLevel(pattern.hihat[7]), 'firmware export must write programmed hihat map level (not velocity-scaled)');
assert(pattern.snare[5].velocity === 80, 'pattern should retain edited snare velocity');

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFirmware = decodeGridsFirmwareWav(stockWav, OFFICIAL_GRIDS_FSK_OPTIONS);
assert(stockFirmware.length === 12672, `decoded stock length mismatch: ${stockFirmware.length}`);
assert(sha256(stockFirmware) === '9b57784ac14b6ac7185392235d0614cfb2e77aebe2595339e628f03c69ba595b', 'stock sha mismatch');
assert(validateGridsFirmwareBinary(stockFirmware).ok, 'stock validation failed');

const targetNodeIndices = interpolationNodeIndicesFromXY(128, 128);
const nodePatches = targetNodeIndices.map((nodeIndex) => ({ nodeIndex, replacementNode: nodeData }));
const patchResult = patchGridsNodesInFirmware(stockFirmware, FALLBACK_FACTORY_NODES, nodePatches);
const validation = validateGridsFirmwareBinary(patchResult.firmware);
assert(validation.ok, `patched firmware validation failed: ${validation.message}`);
const wav = encodeGridsFirmwareWav(patchResult.firmware, OFFICIAL_GRIDS_FSK_OPTIONS);
const roundTrip = decodeGridsFirmwareWav(wav, OFFICIAL_GRIDS_FSK_OPTIONS);
assert(bytesEqual(roundTrip, patchResult.firmware), 'encoded firmware WAV did not round-trip');

console.log(JSON.stringify({
  status: 'ok',
  densityAtProgramming,
  silencingDensity,
  manualKickLevel: manualKick.level,
  thresholdAtProgramming: densityThreshold(densityAtProgramming),
  silencingThreshold: densityThreshold(silencingDensity),
  patchedNodes: targetNodeIndices,
  wavBytes: wav.length,
}, null, 2));
