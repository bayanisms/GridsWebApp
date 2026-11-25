import {
  densityThreshold,
  hardwareTriggered,
  levelForDensityHit,
  makeStepCell,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Knobs are firmware-internal fill values: high density = more notes.
const density = 192;
const cell = makeStepCell({
  active: true,
  density,
  chaos: 0,
  strength: 'accent',
  velocity: 127,
  chaosChance: 100,
  generated: false,
});

const threshold = densityThreshold(density);

assert(
  hardwareTriggered(cell.level, density, 0),
  `programmed step should fire at density ${density}; level ${cell.level}, threshold ${threshold}`,
);

assert(
  levelForDensityHit(density, 'accent') > threshold,
  'levelForDensityHit must sit above the density threshold for stable export',
);

assert(densityThreshold(0) === 255, 'density 0 is silent');
assert(densityThreshold(255) === 0, 'density 255 is densest');

console.log(JSON.stringify({
  status: 'ok',
  density,
  threshold,
  exportedLevel: cell.level,
}, null, 2));
