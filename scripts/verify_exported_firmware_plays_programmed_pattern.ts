import { readFileSync } from 'node:fs';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  OFFICIAL_GRIDS_FSK_OPTIONS,
  patchGridsNodesInFirmware,
} from '../src/avrAudioBootloader';
import {
  DRUM_MAP_LAYOUT,
  FALLBACK_FACTORY_NODES,
  STEPS_PER_PATTERN,
  densityThreshold,
  generatePatternFromFactory,
  hardwareTriggered,
  interpolationNodeIndicesFromXY,
  makeStepCell,
  nodeDataFromPattern,
  type KnobState,
  type PatternState,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cloneNodes(nodes: number[][]): number[][] {
  return nodes.map((node) => [...node]);
}

function u8Mix(a: number, b: number, balance: number): number {
  const ratio = Math.min(255, Math.max(0, balance)) / 255;
  return Math.min(255, Math.max(0, Math.round(a + (b - a) * ratio)));
}

function firmwareReadDrumMap(nodes: number[][], step: number, instrumentIndex: number, x: number, y: number): number {
  const safeX = Math.min(255, Math.max(0, Math.round(x)));
  const safeY = Math.min(255, Math.max(0, Math.round(y)));
  const i = safeX >> 6;
  const j = safeY >> 6;
  const offset = instrumentIndex * STEPS_PER_PATTERN + step;
  const xMix = (safeX << 2) & 0xff;
  const yMix = (safeY << 2) & 0xff;
  const a = nodes[DRUM_MAP_LAYOUT[i][j]][offset] ?? 0;
  const b = nodes[DRUM_MAP_LAYOUT[i + 1][j]][offset] ?? 0;
  const c = nodes[DRUM_MAP_LAYOUT[i][j + 1]][offset] ?? 0;
  const d = nodes[DRUM_MAP_LAYOUT[i + 1][j + 1]][offset] ?? 0;
  return u8Mix(u8Mix(a, b, xMix), u8Mix(c, d, xMix), yMix);
}

function locateFactoryNodeTable(firmware: Uint8Array, expectedFactoryNodes: number[][]): number {
  const table = Uint8Array.from(expectedFactoryNodes.slice(0, 25).flat());
  outer: for (let i = 0; i <= firmware.length - table.length; i += 1) {
    for (let j = 0; j < table.length; j += 1) {
      if (firmware[i + j] !== table[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractNodesFromFirmwareAt(firmware: Uint8Array, offset: number): number[][] {
  assert(offset >= 0, 'could not locate stock factory node table in firmware');
  return Array.from({ length: 25 }, (_, nodeIndex) => Array.from(firmware.slice(offset + nodeIndex * 96, offset + (nodeIndex + 1) * 96)));
}

function commitPatternToNodes(nodes: number[][], knobs: KnobState, pattern: PatternState): number[][] {
  const next = cloneNodes(nodes);
  const replacement = nodeDataFromPattern(pattern);
  for (const nodeIndex of interpolationNodeIndicesFromXY(knobs.x, knobs.y)) {
    next[nodeIndex] = [...replacement];
  }
  return next;
}

const knobs: KnobState = {
  x: 128,
  y: 128,
  chaos: 0,
  density: { kick: 192, snare: 192, hihat: 192 },
};

let editableBank = cloneNodes(FALLBACK_FACTORY_NODES);
let pattern = generatePatternFromFactory(knobs, editableBank);
pattern = {
  ...pattern,
  kick: pattern.kick.map((cell, step) => step === 3
    ? makeStepCell({
        active: true,
        density: knobs.density.kick,
        chaos: knobs.chaos,
        strength: 'accent',
        velocity: 127,
        chaosChance: 100,
        generated: false,
      })
    : cell),
};
editableBank = commitPatternToNodes(editableBank, knobs, pattern);

const changedPatches = editableBank
  .map((node, nodeIndex) => ({ nodeIndex, replacementNode: node }))
  .filter(({ nodeIndex, replacementNode }) => replacementNode.some((value, i) => value !== FALLBACK_FACTORY_NODES[nodeIndex][i]));
assert(changedPatches.length === 1 && changedPatches[0].nodeIndex === 4, `expected center node 4 patch, got ${changedPatches.map((p) => p.nodeIndex).join(',')}`);

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stockFirmware = decodeGridsFirmwareWav(stockWav, OFFICIAL_GRIDS_FSK_OPTIONS);
const nodeTableOffset = locateFactoryNodeTable(stockFirmware, FALLBACK_FACTORY_NODES);
assert(nodeTableOffset >= 0, 'could not locate stock factory node table in stock firmware');
const patchedFirmware = patchGridsNodesInFirmware(stockFirmware, FALLBACK_FACTORY_NODES, changedPatches).firmware;
const exportedWav = encodeGridsFirmwareWav(patchedFirmware, OFFICIAL_GRIDS_FSK_OPTIONS);
const decodedExportedFirmware = decodeGridsFirmwareWav(exportedWav, OFFICIAL_GRIDS_FSK_OPTIONS);
const exportedNodes = extractNodesFromFirmwareAt(decodedExportedFirmware, nodeTableOffset);

const exportedLevel = firmwareReadDrumMap(exportedNodes, 3, 0, knobs.x, knobs.y);
const threshold = densityThreshold(knobs.density.kick);
assert(exportedLevel === editableBank[4][3], `decoded firmware node level mismatch: read ${exportedLevel}, bank ${editableBank[4][3]}`);
assert(exportedLevel > threshold, `programmed kick step is below firmware threshold: level ${exportedLevel}, threshold ${threshold}`);
assert(hardwareTriggered(exportedLevel, knobs.density.kick, 0), 'app hardware trigger model says exported programmed step will not fire');

console.log(JSON.stringify({
  status: 'ok',
  patchedNodes: changedPatches.map((p) => p.nodeIndex),
  programmedStep: 4,
  exportedLevel,
  threshold,
  exportedWavBytes: exportedWav.length,
}, null, 2));
