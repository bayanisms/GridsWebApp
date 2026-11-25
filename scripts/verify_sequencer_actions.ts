import {
  INSTRUMENTS,
  createPatternFromProgrammedSteps,
  densityThreshold,
  mapLevelForCell,
  randomizeSequencerPattern,
  type KnobState,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const knobs: KnobState = {
  x: 128,
  y: 128,
  chaos: 96,
  density: { kick: 192, snare: 144, hihat: 216 },
};

const cleared = createPatternFromProgrammedSteps();
for (const instrument of INSTRUMENTS) {
  assert(cleared[instrument].length === 32, `${instrument} clear length mismatch`);
  for (const cell of cleared[instrument]) {
    assert(!cell.active, `${instrument} clear left an active step`);
    assert(mapLevelForCell(cell) === 0, `${instrument} clear left a firmware map level`);
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const first = randomizeSequencerPattern(knobs, seededRandom(0x47524944));
const second = randomizeSequencerPattern(knobs, seededRandom(0x47524944));
assert(JSON.stringify(first) === JSON.stringify(second), 'seeded random pattern is not deterministic');

const activeCounts: Record<string, number> = {};
for (const instrument of INSTRUMENTS) {
  const cells = first[instrument];
  activeCounts[instrument] = cells.filter((cell) => cell.active).length;
  assert(activeCounts[instrument] > 0, `${instrument} random track is empty`);
  assert(activeCounts[instrument] < 32, `${instrument} random track is completely full`);
  for (const cell of cells) {
    assert(cell.generated === false, `${instrument} random cell must be user-programmed`);
    if (cell.active) {
      assert(cell.chaosChance === 100, `${instrument} random hit must be hardware-stable`);
      assert(cell.velocity >= 64 && cell.velocity <= 127, `${instrument} velocity out of range`);
      assert(cell.level > densityThreshold(knobs.density[instrument]), `${instrument} hit is not stable`);
    } else {
      assert(mapLevelForCell(cell) === 0, `${instrument} inactive random step has a map level`);
    }
  }
}

console.log(JSON.stringify({ status: 'ok', activeCounts }, null, 2));
