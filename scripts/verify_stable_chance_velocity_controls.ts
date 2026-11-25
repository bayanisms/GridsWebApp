import {
  densityThreshold,
  encodeMapLevel,
  fireProbability,
  makeStepCell,
  preferredLevelFromVelocity,
  velocityFromMapLevel,
  canProgramVelocity,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Regression: velocity must never make a partial chance become guaranteed.
const lowVelocityLevel = encodeMapLevel({
  density: 192,
  chaos: 32,
  velocity: 1,
  chaosChance: 90,
});
const highVelocityLevel = encodeMapLevel({
  density: 192,
  chaos: 32,
  velocity: 127,
  chaosChance: 90,
});
assert(
  highVelocityLevel === lowVelocityLevel,
  `partial chance changed with velocity: ${lowVelocityLevel} -> ${highVelocityLevel}`,
);
assert(
  fireProbability(highVelocityLevel, 192, 32) < 1,
  '90% chance became a guaranteed trigger at high velocity',
);

// Partial chance owns the map byte: velocity cannot alter its hardware probability.
for (const density of [32, 64, 128, 192, 224]) {
  for (const chaos of [4, 16, 32, 64, 128, 255]) {
    for (const chance of [10, 25, 50, 75, 90]) {
      const levelA = encodeMapLevel({ density, chaos, velocity: 1, chaosChance: chance });
      const levelB = encodeMapLevel({ density, chaos, velocity: 127, chaosChance: chance });
      assert(
        levelA === levelB,
        `velocity changed partial level at d=${density} c=${chaos} p=${chance}: ${levelA}/${levelB}`,
      );
    }
  }
}

// With no hardware Chaos, partial chance must not lie by becoming always-on.
const noChaosLevel = encodeMapLevel({
  density: 128,
  chaos: 0,
  velocity: 100,
  chaosChance: 50,
});
assert(
  fireProbability(noChaosLevel, 128, 0) === 0,
  `50% at Chaos 0 must wait for Chaos, got level ${noChaosLevel}`,
);
const pendingChanceCell = makeStepCell({
  active: true,
  density: 128,
  chaos: 0,
  velocity: 100,
  chaosChance: 50,
  generated: false,
});
assert(pendingChanceCell.active, 'partial-chance intent must remain editable at Chaos 0');
assert(pendingChanceCell.chaosChance === 50, 'partial-chance intent was discarded');

// Velocity range should include the full stable hardware-level range without an offset jump.
assert(
  preferredLevelFromVelocity(128, 1) === densityThreshold(128) + 1,
  'minimum velocity must map to the first stable hardware level',
);
assert(preferredLevelFromVelocity(128, 127) === 255, 'maximum velocity must map to 255');
assert(canProgramVelocity(100), 'velocity must be editable at 100% chance');
assert(!canProgramVelocity(99), 'velocity must be locked while partial chance owns the map byte');
assert(!canProgramVelocity(1), 'velocity must be locked while partial chance owns the map byte');

// A saved stable map byte must reconstruct the same level after reload/regeneration.
for (const density of [32, 64, 128, 192, 224]) {
  for (const velocity of [1, 16, 32, 64, 96, 112, 127]) {
    const encoded = preferredLevelFromVelocity(density, velocity);
    const restoredVelocity = velocityFromMapLevel(encoded, density);
    const reencoded = preferredLevelFromVelocity(density, restoredVelocity);
    assert(
      reencoded === encoded,
      `velocity round-trip drifted at d=${density}, v=${velocity}: level ${encoded} -> v${restoredVelocity} -> ${reencoded}`,
    );
  }
}

console.log(JSON.stringify({
  status: 'ok',
  partialLevel: highVelocityLevel,
  partialProbability: fireProbability(highVelocityLevel, 192, 32),
  noChaosLevel,
  minStableLevel: preferredLevelFromVelocity(128, 1),
}, null, 2));
