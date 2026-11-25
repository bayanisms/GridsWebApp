import {
  FALLBACK_FACTORY_NODES,
  generatePatternFromFactory,
  interpolationNodeIndicesFromXY,
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

function commitPatternToNodes(nodes: number[][], knobs: KnobState, pattern: PatternState, dirty: boolean): number[][] {
  if (!dirty) {
    return nodes;
  }

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

const center: KnobState = {
  x: 128,
  y: 128,
  chaos: 64,
  density: { kick: 192, snare: 144, hihat: 216 },
};
const offGrid: KnobState = {
  ...center,
  x: 96,
  y: 127,
};

let bank = cloneNodes(FALLBACK_FACTORY_NODES);

// User merely navigates away from center to an off-grid interpolated X/Y location.
// No user edit happened, so saving should NOT mutate any node in the bank.
const offGridGeneratedPreview = generatePatternFromFactory(offGrid, bank);
bank = commitPatternToNodes(bank, offGrid, offGridGeneratedPreview, false);
const changed = changedNodeIndices(bank);

assert(changed.length === 0, `pure X/Y navigation mutated default nodes: ${changed.join(', ')}`);

console.log(JSON.stringify({ status: 'ok', changedNodes: changed }, null, 2));
