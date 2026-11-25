import {
  encodeMapLevel,
  fireProbability,
  hardwareTriggered,
  makeStepCell,
  maxPartPerturbation,
  nodeDataFromPattern,
  createPatternFromProgrammedSteps,
  samplePartPerturbation,
  chaosRandomness,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const density = 160;
const chaos = 200;

// Velocity 127 + 100% chance → stable hot level, always fires at chaos 0
const hard = makeStepCell({
  active: true,
  density,
  chaos,
  velocity: 127,
  chaosChance: 100,
  generated: false,
});
assert(hard.level > 192, `high velocity should reach accent territory, got level ${hard.level}`);
assert(hardwareTriggered(hard.level, density, 0), '100% chance must fire with zero chaos boost');
assert(Math.abs(fireProbability(hard.level, density, chaos) - 1) < 1e-9, '100% chance must have P=1');

// 50% chance → chaos-sensitive band
const mid = makeStepCell({
  active: true,
  density,
  chaos,
  velocity: 80,
  chaosChance: 50,
  generated: false,
});
const pMid = fireProbability(mid.level, density, chaos);
assert(pMid > 0.25 && pMid < 0.75, `50% chance encode should be near mid, got P=${pMid}`);
assert(!hardwareTriggered(mid.level, density, 0), 'partial chance must not be stable at chaos 0');
assert(
  hardwareTriggered(mid.level, density, maxPartPerturbation(chaos)),
  'partial chance must be reachable at max chaos boost',
);

// Exact: fraction of Random::GetByte outcomes that fire equals fireProbability
const R = chaosRandomness(chaos);
let hits = 0;
for (let b = 0; b < 256; b += 1) {
  if (hardwareTriggered(mid.level, density, samplePartPerturbation(R, b))) hits += 1;
}
assert(hits / 256 === pMid, 'fireProbability must match full 256-byte histogram');

// Export level is the same byte used for triggering
const pattern = createPatternFromProgrammedSteps();
pattern.kick[0] = mid;
pattern.kick[1] = hard;
const node = nodeDataFromPattern(pattern);
assert(node[0] === mid.level, 'export must write encoded map level for chance step');
assert(node[1] === hard.level, 'export must write encoded map level for velocity step');

// encodeMapLevel direct check
const lvl = encodeMapLevel({ density, chaos, velocity: 64, chaosChance: 30 });
const p = fireProbability(lvl, density, chaos);
assert(Math.abs(p - 0.3) < 0.12, `30% target should be close, got ${p}`);

// Chaos 0: only 0 or 100 representable
const noChaos = makeStepCell({
  active: true,
  density,
  chaos: 0,
  velocity: 100,
  chaosChance: 40,
  generated: false,
});
assert(
  !hardwareTriggered(noChaos.level, density, 0),
  'with Chaos 0, partial chance must wait silently instead of becoming a guaranteed hit',
);
assert(noChaos.active, 'partial chance intent must remain editable while Chaos is 0');

console.log(JSON.stringify({
  status: 'ok',
  hardLevel: hard.level,
  midLevel: mid.level,
  midP: pMid,
  encode30P: p,
  noChaosLevel: noChaos.level,
}, null, 2));
