import {
  classifyStepTrigger,
  chaosRandomness,
  densityThreshold,
  hardwareTriggered,
  maxPartPerturbation,
  samplePartPerturbation,
  makeStepCell,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Chaos 0 = none, 255 = max. randomness = chaos >> 2
const chaos = 255;
const randomness = chaosRandomness(chaos);
assert(randomness === (255 >> 2), `expected randomness 63 at chaos 255, got ${randomness}`);
assert(samplePartPerturbation(randomness, 255) === maxPartPerturbation(chaos), 'max pert mismatch');
assert(samplePartPerturbation(63, 255) === ((255 * 63) >> 8), 'U8U8MulShift8 mismatch');
assert(chaosRandomness(0) === 0, 'chaos 0 should disable randomness');
assert(maxPartPerturbation(0) === 0, 'chaos 0 should yield zero boost');

const density = 128;
const threshold = densityThreshold(density);
assert(threshold === 127, 'density 128 → threshold 127');

const maxBoost = maxPartPerturbation(chaos);
const borderlineLevel = threshold - Math.floor(maxBoost / 2);
assert(borderlineLevel > 0, 'borderline level should stay positive');
const cell = makeStepCell({
  active: true,
  density,
  level: borderlineLevel,
  strength: 'soft',
  velocity: 64,
  generated: false,
});

assert(!hardwareTriggered(cell.level, density, 0), 'borderline should not fire without chaos boost');
assert(
  hardwareTriggered(cell.level, density, maxBoost),
  'borderline should fire with max hardware chaos boost',
);
assert(
  classifyStepTrigger(cell, density, chaos) === 'chaos-sensitive',
  'borderline must classify as chaos-sensitive',
);

const stable = makeStepCell({
  active: true,
  density,
  strength: 'accent',
  velocity: 127,
  generated: false,
});
assert(classifyStepTrigger(stable, density, chaos) === 'stable', 'accent hit should be stable');

const ghost = makeStepCell({
  active: true,
  density,
  level: 1,
  strength: 'soft',
  velocity: 1,
  generated: false,
});
assert(classifyStepTrigger(ghost, density, 0) === 'ghost', 'tiny level should remain ghost at chaos 0');

console.log(JSON.stringify({
  status: 'ok',
  chaos,
  randomness,
  maxBoost,
  threshold,
  borderlineLevel,
  classifications: {
    borderline: classifyStepTrigger(cell, density, chaos),
    stable: classifyStepTrigger(stable, density, chaos),
    ghost: classifyStepTrigger(ghost, density, 0),
  },
}, null, 2));
