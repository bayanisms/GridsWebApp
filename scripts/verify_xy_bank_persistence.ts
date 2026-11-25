import {
  FALLBACK_FACTORY_NODES,
  generatePatternFromFactory,
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

function commitPatternToNodes(nodes: number[][], knobs: KnobState, pattern: PatternState): number[][] {
  const next = cloneNodes(nodes);
  const replacement = nodeDataFromPattern(pattern);
  for (const nodeIndex of interpolationNodeIndicesFromXY(knobs.x, knobs.y)) {
    next[nodeIndex] = [...replacement];
  }
  return next;
}

const baseKnobs: KnobState = {
  x: 128,
  y: 128,
  chaos: 64,
  density: { kick: 192, snare: 144, hihat: 216 },
};

let bank = cloneNodes(FALLBACK_FACTORY_NODES);
let centerPattern = generatePatternFromFactory(baseKnobs, bank);
const originalCenterKick0 = centerPattern.kick[0].level;
const originalCornerKick0 = generatePatternFromFactory({ ...baseKnobs, x: 0, y: 0 }, bank).kick[0].level;

const bankAfterNoopCommit = commitPatternToNodes(bank, baseKnobs, centerPattern);
const noopChangedNodes = bankAfterNoopCommit
  .map((node, index) => ({ index, changed: node.some((value, i) => value !== FALLBACK_FACTORY_NODES[index][i]) }))
  .filter((entry) => entry.changed)
  .map((entry) => entry.index);
assert(noopChangedNodes.length === 0, 'committing an unchanged generated pattern must not rewrite default bank nodes');

centerPattern = {
  ...centerPattern,
  kick: centerPattern.kick.map((cell, step) => step === 3
    ? makeStepCell({ active: true, density: baseKnobs.density.kick, chaos: baseKnobs.chaos, strength: 'accent', velocity: 127, chaosChance: 100, generated: false })
    : cell),
};
bank = commitPatternToNodes(bank, baseKnobs, centerPattern);

const editedCenterPattern = generatePatternFromFactory(baseKnobs, bank);
const untouchedCornerPattern = generatePatternFromFactory({ ...baseKnobs, x: 0, y: 0 }, bank);
assert(editedCenterPattern.kick[0].level !== originalCenterKick0 || editedCenterPattern.kick[0].active, 'center edit should be saved into bank');
assert(untouchedCornerPattern.kick[0].level === originalCornerKick0, 'moving to an unrelated XY area should not reuse the edited center kick pattern');

const editedNode = interpolationNodeIndicesFromXY(baseKnobs.x, baseKnobs.y)[0];
const changedNodes = bank
  .map((node, index) => ({ index, changed: node.some((value, i) => value !== FALLBACK_FACTORY_NODES[index][i]) }))
  .filter((entry) => entry.changed)
  .map((entry) => entry.index);
assert(changedNodes.includes(editedNode), 'edited node must be changed in the bank');
assert(changedNodes.length === interpolationNodeIndicesFromXY(baseKnobs.x, baseKnobs.y).length, 'only affected interpolation nodes should change');

console.log(JSON.stringify({
  status: 'ok',
  editedNode,
  changedNodes,
  originalCenterKick0,
  editedCenterKick4: editedCenterPattern.kick[3].level,
  originalCornerKick0,
  untouchedCornerKick0: untouchedCornerPattern.kick[0].level,
}, null, 2));
