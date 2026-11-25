import {
  FALLBACK_FACTORY_NODES,
  generatePatternFromFactory,
  interpolationNodeIndicesFromXY,
  makeStepCell,
  nodeDataFromPattern,
  nodeIndexFromXY,
  type KnobState,
  type PatternState,
} from '../src/grids';
import { buildLookupTablesPython } from '../src/firmwareExport';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  OFFICIAL_GRIDS_FSK_OPTIONS,
  patchGridsNodesInFirmware,
  validateGridsFirmwareBinary,
} from '../src/avrAudioBootloader';
import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cloneNodes(nodes: number[][]): number[][] {
  return nodes.map((node) => [...node]);
}

function commitPatternToNodes(nodes: number[][], knobs: KnobState, pattern: PatternState): number[][] {
  const next = cloneNodes(nodes);
  const replacement = nodeDataFromPattern(pattern);
  for (const nodeIndex of interpolationNodeIndicesFromXY(knobs.x, knobs.y)) {
    next[nodeIndex] = [...replacement];
  }
  return next;
}

function changedNodeIndices(nodes: number[][]): number[] {
  return nodes
    .map((node, index) => ({ index, changed: node.some((value, i) => value !== FALLBACK_FACTORY_NODES[index][i]) }))
    .filter((entry) => entry.changed)
    .map((entry) => entry.index);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const centerKnobs: KnobState = {
  x: 128,
  y: 128,
  chaos: 64,
  density: { kick: 192, snare: 144, hihat: 216 },
};
const cornerKnobs: KnobState = {
  ...centerKnobs,
  x: 0,
  y: 0,
};

let bank = cloneNodes(FALLBACK_FACTORY_NODES);
const unchangedCenter = generatePatternFromFactory(centerKnobs, bank);
bank = commitPatternToNodes(bank, centerKnobs, unchangedCenter);
assert(changedNodeIndices(bank).length === 0, 'no-op generated/default commit changed a factory node');

let centerPattern = generatePatternFromFactory(centerKnobs, bank);
const originalCornerKick0 = generatePatternFromFactory(cornerKnobs, bank).kick[0].level;
centerPattern = {
  ...centerPattern,
  kick: centerPattern.kick.map((cell, step) => step === 3
    ? makeStepCell({ active: true, density: centerKnobs.density.kick, chaos: centerKnobs.chaos, strength: 'accent', velocity: 127, chaosChance: 100, generated: false })
    : cell),
};
bank = commitPatternToNodes(bank, centerKnobs, centerPattern);
const changed = changedNodeIndices(bank);
assert(changed.length === 1 && changed[0] === 4, `expected only center node 4 changed, got ${changed.join(',')}`);
assert(generatePatternFromFactory(cornerKnobs, bank).kick[0].level === originalCornerKick0, 'editing center node changed unrelated corner playback');

const stockWav = new Uint8Array(readFileSync('src/assets/grids_1.0.wav'));
const stock = decodeGridsFirmwareWav(stockWav, OFFICIAL_GRIDS_FSK_OPTIONS);
const stockValidation = validateGridsFirmwareBinary(stock);
assert(stockValidation.ok, `stock validation failed: ${stockValidation.message}`);
const nodePatches = changed.map((nodeIndex) => ({ nodeIndex, replacementNode: bank[nodeIndex] }));
const patched = patchGridsNodesInFirmware(stock, FALLBACK_FACTORY_NODES, nodePatches).firmware;
assert(patched.length === stock.length, 'node patch changed firmware binary size');
assert(patched.length < 0x7000, 'patched firmware crossed Grids bootloader boundary');

const wavBytes = encodeGridsFirmwareWav(patched, OFFICIAL_GRIDS_FSK_OPTIONS);
const decodedExport = decodeGridsFirmwareWav(wavBytes, OFFICIAL_GRIDS_FSK_OPTIONS);
assert(bytesEqual(decodedExport, patched), 'exported WAV did not decode back to patched firmware bytes');

const python = buildLookupTablesPython(bank, '2026-07-06T00:00:00.000Z', nodeIndexFromXY(centerKnobs.x, centerKnobs.y), changed);
assert(python.includes('nodes = [') && python.includes('drum_map_nodes.append'), 'lookup_tables.py export missing editable node table');
assert(python.includes('# Patched node indices: 4'), 'lookup_tables.py export missing modified-node metadata');
assert(!python.includes('xrange'), 'lookup_tables.py export still contains Python 2 xrange');

console.log(JSON.stringify({
  status: 'ok',
  stockBytes: stock.length,
  patchedBytes: patched.length,
  changedNodes: changed,
  wavBytes: wavBytes.length,
  decodedBytes: decodedExport.length,
  pythonChars: python.length,
}, null, 2));
