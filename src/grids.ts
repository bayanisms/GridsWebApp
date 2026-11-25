import { OFFICIAL_FACTORY_NODES } from './factoryNodes';

export const STEPS_PER_PATTERN = 32;

export const INSTRUMENTS = ['kick', 'snare', 'hihat'] as const;

export type InstrumentKey = (typeof INSTRUMENTS)[number];

export const INSTRUMENT_LABELS: Record<InstrumentKey, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-hat',
};

export type StepStrength = 'soft' | 'normal' | 'accent';

/** How a programmed step behaves on Grids hardware at the current Density/Chaos. */
export type StepTriggerClass = 'off' | 'ghost' | 'stable' | 'chaos-sensitive';

/**
 * Sequencer step. Hardware only stores `level` in the drum map.
 * Velocity + chaosChance are the friendly programmers' controls; both encode into `level`
 * using the same EvaluateDrums math the module runs, so browser and hardware match.
 */
export interface StepCell {
  active: boolean;
  strength: StepStrength;
  /** Firmware drum-map byte (0-255). Source of truth for triggers on hardware. */
  level: number;
  /**
   * Programmer velocity 1-127. Encodes into map level (higher = hotter level / accent).
   * Same value drives browser hit loudness via level.
   */
  velocity: number;
  /**
   * Programmer chance 0-100. Encoded by placing level relative to FILL threshold and
   * Chaos bar-boost range so P(fire) on hardware ≈ this % at the same Density/Chaos.
   */
  chaosChance: number;
  generated?: boolean;
}

export type PatternState = Record<InstrumentKey, StepCell[]>;

/**
 * Knob values match firmware `settings_` after `~adc.Read8()`:
 * - density 0 = no notes, 255 = densest (threshold = ~density)
 * - chaos 0 = none, 255 = max bar-hold randomness
 * - x/y are internal map coordinates used by ReadDrumMap
 */
export interface KnobState {
  x: number;
  y: number;
  chaos: number;
  density: Record<InstrumentKey, number>;
}

export const DRUM_MAP_LAYOUT: number[][] = [
  [10, 8, 0, 9, 11],
  [15, 7, 13, 12, 6],
  [18, 14, 4, 5, 3],
  [23, 16, 21, 1, 2],
  [24, 19, 17, 20, 22],
];

export const MAP_NODE_LAYOUT = DRUM_MAP_LAYOUT;

export const EMBEDDED_FACTORY_NODES: number[][] = OFFICIAL_FACTORY_NODES.map((node) => [...node]);

export const FALLBACK_FACTORY_NODES = EMBEDDED_FACTORY_NODES;

export const STEP_STRENGTH_MARGIN: Record<StepStrength, number> = {
  soft: 8,
  normal: 32,
  accent: 80,
};

export const STEP_STRENGTH_VELOCITY: Record<StepStrength, number> = {
  soft: 0.45,
  normal: 0.75,
  accent: 1,
};

function u8Mix(a: number, b: number, balance: number): number {
  const ratio = clampNumber(balance, 0, 255) / 255;
  return clampNumber(Math.round(a + (b - a) * ratio), 0, 255);
}

function readNodeValue(node: number[] | undefined, offset: number): number {
  if (!node) {
    return 0;
  }
  return node[offset] ?? 0;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Physical panel ADC ↔ firmware internal (`~adc.Read8()`). Optional readout only. */
export function physicalControlToInternal(value: number): number {
  return (~clampNumber(Math.round(value), 0, 255)) & 0xff;
}

export function internalControlToPhysical(value: number): number {
  return physicalControlToInternal(value);
}

/** Firmware: `uint8_t threshold = ~settings_.density[i]`. density 0 → thr 255 (silent). */
export function densityThreshold(density: number): number {
  return (~clampNumber(Math.round(density), 0, 255)) & 0xff;
}

/** Firmware: `settings_.options.drums.randomness >> 2`. */
export function chaosRandomness(chaos: number): number {
  return clampNumber(Math.round(chaos), 0, 255) >> 2;
}

/** avrlib `U8U8MulShift8(a, b)` = (a * b) >> 8. */
export function u8u8MulShift8(a: number, b: number): number {
  return ((clampNumber(Math.round(a), 0, 255) * clampNumber(Math.round(b), 0, 255)) >> 8) & 0xff;
}

/** `part_perturbation_[i] = U8U8MulShift8(Random::GetByte(), randomness)`. */
export function samplePartPerturbation(randomness: number, randomByte: number): number {
  return u8u8MulShift8(randomByte, randomness);
}

export function maxPartPerturbation(chaos: number): number {
  return samplePartPerturbation(chaosRandomness(chaos), 255);
}

export function averagePartPerturbation(chaos: number): number {
  return samplePartPerturbation(chaosRandomness(chaos), 128);
}

/** @deprecated Prefer averagePartPerturbation. */
export function averageChaosPerturbation(chaos: number): number {
  return averagePartPerturbation(chaos);
}

/**
 * Firmware EvaluateDrums: boost level by bar perturbation, then `level > ~density`.
 */
export function hardwareTriggered(
  level: number,
  density: number,
  chaosPerturbation = 0,
): boolean {
  const safeLevel = clampNumber(Math.round(level), 0, 255);
  const safePerturbation = clampNumber(Math.round(chaosPerturbation), 0, 255);
  const perturbed = safeLevel < 255 - safePerturbation
    ? safeLevel + safePerturbation
    : 255;
  return perturbed > densityThreshold(density);
}

/**
 * Exact P(fire) under hardware Chaos RNG: for each Random::GetByte() 0..255,
 * boost = U8U8MulShift8(byte, chaos>>2), fire if level+boost > ~density.
 */
export function fireProbability(level: number, density: number, chaos: number): number {
  const randomness = chaosRandomness(chaos);
  if (randomness === 0) {
    return hardwareTriggered(level, density, 0) ? 1 : 0;
  }
  let hits = 0;
  for (let randomByte = 0; randomByte < 256; randomByte += 1) {
    if (hardwareTriggered(level, density, samplePartPerturbation(randomness, randomByte))) {
      hits += 1;
    }
  }
  return hits / 256;
}

/**
 * Preferred stable map level for a velocity at the current density.
 * velocity 1 → just above threshold; 127 → 255 (accent territory).
 */
export function preferredLevelFromVelocity(density: number, velocity: number): number {
  const thr = densityThreshold(density);
  const minStable = clampNumber(thr + 1, 1, 255);
  const vel = clampNumber(Math.round(velocity), 1, 127);
  const span = 255 - minStable;
  return clampNumber(minStable + Math.round(((vel - 1) / 126) * span), minStable, 255);
}

/** Recover the stable-hit velocity intent that most closely reproduces a saved map byte. */
export function velocityFromMapLevel(level: number, density: number): number {
  const target = clampNumber(Math.round(level), 1, 255);
  let bestVelocity = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let velocity = 1; velocity <= 127; velocity += 1) {
    const error = Math.abs(preferredLevelFromVelocity(density, velocity) - target);
    if (error < bestError) {
      bestError = error;
      bestVelocity = velocity;
    }
  }
  return bestVelocity;
}

/** Velocity can own Grids' single map byte only for a guaranteed step. */
export function canProgramVelocity(chaosChance: number): boolean {
  return clampNumber(Math.round(chaosChance), 0, 100) >= 100;
}

/**
 * Encode programmer velocity + chance into a single map level so that at the
 * given Density/Chaos, hardware P(fire) ≈ chance/100 and hotter velocity
 * prefers hotter levels (accent when high).
 *
 * Chance needs Chaos > 0 on the module to be probabilistic; at Chaos 0 only
 * 0% (off) and 100% (stable) are representable.
 */
export function encodeMapLevel(options: {
  density: number;
  chaos: number;
  velocity: number;
  chaosChance: number;
}): number {
  const density = clampNumber(Math.round(options.density), 0, 255);
  const chaos = clampNumber(Math.round(options.chaos), 0, 255);
  const velocity = clampNumber(Math.round(options.velocity), 1, 127);
  const chance = clampNumber(Math.round(options.chaosChance), 0, 100);
  const thr = densityThreshold(density);
  const preferred = preferredLevelFromVelocity(density, velocity);

  if (chance <= 0) {
    return 0;
  }

  // A stable hit is the only case where velocity can own the map-level byte.
  if (chance >= 100) {
    return preferred;
  }

  // Partial probability does not exist without Chaos. Keep the requested step
  // below the trigger threshold instead of silently turning it into 100%.
  if (chaosRandomness(chaos) === 0) {
    return thr;
  }

  const targetP = chance / 100;
  let bestLevel = 1;
  let bestProbabilityError = Number.POSITIVE_INFINITY;

  for (let level = 1; level <= 255; level += 1) {
    const p = fireProbability(level, density, chaos);
    const pErr = Math.abs(p - targetP);
    // Chance owns the only hardware byte for partial-probability steps.
    // Never trade probability accuracy for velocity. On equal-probability
    // plateaus choose the hotter level deterministically.
    if (pErr < bestProbabilityError || (pErr === bestProbabilityError && level > bestLevel)) {
      bestProbabilityError = pErr;
      bestLevel = level;
    }
  }

  // Never encode a "partial chance" that is actually always-off at this Chaos.
  if (fireProbability(bestLevel, density, chaos) <= 0 && chance > 0) {
    return clampNumber(thr - maxPartPerturbation(chaos) + 1, 1, thr);
  }
  return bestLevel;
}

/** Infer programmer chance % from an existing map level (factory or imported). */
export function chanceFromMapLevel(level: number, density: number, chaos: number): number {
  if (level <= 0) {
    return 0;
  }
  return clampNumber(Math.round(fireProbability(level, density, chaos) * 100), 0, 100);
}

export function classifyStepTrigger(
  cell: StepCell,
  density: number,
  chaos = 0,
): StepTriggerClass {
  const level = mapLevelForCell(cell);
  if (hardwareTriggered(level, density, 0)) {
    return 'stable';
  }
  if (hardwareTriggered(level, density, maxPartPerturbation(chaos))) {
    return 'chaos-sensitive';
  }
  return cell.active ? 'ghost' : 'off';
}

/** Deterministic UI: average chaos boost (not a random bar). */
export function isStepTriggered(cell: StepCell, density: number, chaos = 0): boolean {
  return hardwareTriggered(mapLevelForCell(cell), density, averagePartPerturbation(chaos));
}

export function levelToVelocity(level: number): number {
  return level > 0 ? clampNumber(Math.round((level / 255) * 127), 1, 127) : 0;
}

export function strengthFromLevel(level: number): StepStrength {
  if (level > 192) {
    return 'accent';
  }
  if (level > 96) {
    return 'normal';
  }
  return 'soft';
}

/** Program a stable hit (100% chance) at density with strength margin / velocity. */
export function levelForDensityHit(density: number, strength: StepStrength = 'normal'): number {
  return clampNumber(densityThreshold(density) + STEP_STRENGTH_MARGIN[strength], 1, 255);
}

export function makeStepCell(options: {
  active: boolean;
  density: number;
  chaos?: number;
  strength?: StepStrength;
  level?: number;
  velocity?: number;
  chaosChance?: number;
  generated?: boolean;
}): StepCell {
  const strength = options.strength ?? 'normal';
  const chaos = options.chaos ?? 0;
  const density = options.density;

  if (!options.active) {
    return {
      active: false,
      strength: 'normal',
      level: 0,
      velocity: 0,
      chaosChance: 0,
      generated: options.generated,
    };
  }

  // Explicit level (factory map / import): derive velocity + chance from it.
  if (options.level !== undefined) {
    const level = clampNumber(Math.round(options.level), 1, 255);
    const chaosChance = options.chaosChance !== undefined
      ? clampNumber(Math.round(options.chaosChance), 0, 100)
      : chanceFromMapLevel(level, density, chaos);
    return {
      active: true,
      strength: strengthFromLevel(level),
      level,
      velocity: options.velocity !== undefined
        ? clampNumber(Math.round(options.velocity), 1, 127)
        : canProgramVelocity(chaosChance)
          ? velocityFromMapLevel(level, density)
          : levelToVelocity(level),
      chaosChance,
      generated: options.generated,
    };
  }

  const velocity = clampNumber(
    Math.round(options.velocity ?? Math.round(STEP_STRENGTH_VELOCITY[strength] * 127)),
    1,
    127,
  );
  const chaosChance = clampNumber(Math.round(options.chaosChance ?? 100), 0, 100);
  const level = encodeMapLevel({ density, chaos, velocity, chaosChance });

  return {
    // Preserve programmer intent even if current Chaos/FILL cannot fire it.
    active: true,
    strength: level > 0 ? strengthFromLevel(level) : strength,
    level,
    velocity,
    chaosChance,
    generated: options.generated,
  };
}

/** Re-encode a user step after Density/Chaos/velocity/chance edits so map level stays in sync. */
export function reencodeUserStep(
  cell: StepCell,
  density: number,
  chaos: number,
  overrides: Partial<Pick<StepCell, 'active' | 'velocity' | 'chaosChance' | 'strength'>> = {},
): StepCell {
  const active = overrides.active ?? cell.active;
  if (!active) {
    return makeStepCell({ active: false, density, chaos, generated: false });
  }
  const strength = overrides.strength ?? cell.strength;
  const velocity = overrides.velocity ?? (cell.velocity || Math.round(STEP_STRENGTH_VELOCITY[strength] * 127));
  const chaosChance = overrides.chaosChance ?? cell.chaosChance;
  return makeStepCell({
    active: true,
    density,
    chaos,
    strength,
    velocity,
    chaosChance,
    generated: false,
  });
}

export function createEmptyStepCell(): StepCell {
  return {
    active: false,
    strength: 'normal',
    level: 0,
    velocity: 0,
    chaosChance: 0,
    generated: false,
  };
}

export function createPatternFromProgrammedSteps(): PatternState {
  return {
    kick: Array.from({ length: STEPS_PER_PATTERN }, createEmptyStepCell),
    snare: Array.from({ length: STEPS_PER_PATTERN }, createEmptyStepCell),
    hihat: Array.from({ length: STEPS_PER_PATTERN }, createEmptyStepCell),
  };
}

const RANDOM_HIT_PROBABILITY: Record<InstrumentKey, number> = {
  kick: 0.28,
  snare: 0.22,
  hihat: 0.48,
};

/** Create a varied pattern whose active hits map directly to stable hardware levels. */
export function randomizeSequencerPattern(
  knobs: KnobState,
  random: () => number = Math.random,
): PatternState {
  const pattern = createPatternFromProgrammedSteps();
  const nextRandom = () => clampNumber(random(), 0, 0.999999999999);

  for (const instrument of INSTRUMENTS) {
    const density = knobs.density[instrument];
    const probability = RANDOM_HIT_PROBABILITY[instrument];
    const track = pattern[instrument];

    for (let step = 0; step < STEPS_PER_PATTERN; step += 1) {
      if (nextRandom() >= probability) {
        continue;
      }
      const velocity = 64 + Math.floor(nextRandom() * 64);
      track[step] = makeStepCell({
        active: true,
        density,
        chaos: knobs.chaos,
        velocity,
        chaosChance: 100,
        generated: false,
      });
    }

    // Never surprise the user with an entirely empty random track.
    if (!track.some((cell) => cell.active)) {
      const step = Math.floor(nextRandom() * STEPS_PER_PATTERN);
      const velocity = 64 + Math.floor(nextRandom() * 64);
      track[step] = makeStepCell({
        active: true,
        density,
        chaos: knobs.chaos,
        velocity,
        chaosChance: 100,
        generated: false,
      });
    }
  }

  return pattern;
}

/** Map level written to Grids drum-map nodes — the only per-step value hardware has. */
export function mapLevelForCell(cell: StepCell): number {
  if (!cell.active || cell.level <= 0) {
    return 0;
  }
  return clampNumber(Math.round(cell.level), 1, 255);
}

export function nodeDataFromPattern(pattern: PatternState): number[] {
  const out: number[] = [];
  for (const instrument of INSTRUMENTS) {
    for (const cell of pattern[instrument]) {
      out.push(mapLevelForCell(cell));
    }
  }
  return out;
}

export function visibleVelocityForStep(cell: StepCell, density: number, chaos = 0): number {
  return isStepTriggered(cell, density, chaos) ? levelToVelocity(cell.level) : 0;
}

/** Browser hit gain from map level (matches hardware accent/importance feel). */
export function playbackGainFromLevel(level: number): number {
  return clampNumber(level / 255, 0.05, 1);
}

export function nodeIndexFromXY(x: number, y: number): number {
  const qx = clampNumber(Math.round(clampNumber(x, 0, 255) / 64), 0, 4);
  const qy = clampNumber(Math.round(clampNumber(y, 0, 255) / 64), 0, 4);
  return MAP_NODE_LAYOUT[qx][qy];
}

export function interpolationNodeIndicesFromXY(x: number, y: number): number[] {
  const safeX = clampNumber(Math.round(x), 0, 255);
  const safeY = clampNumber(Math.round(y), 0, 255);
  const i = safeX >> 6;
  const j = safeY >> 6;
  const xMix = (safeX << 2) & 0xff;
  const yMix = (safeY << 2) & 0xff;

  const weightedNodes: Array<[number, number]> = [
    [DRUM_MAP_LAYOUT[i][j], (255 - xMix) * (255 - yMix)],
    [DRUM_MAP_LAYOUT[i + 1][j], xMix * (255 - yMix)],
    [DRUM_MAP_LAYOUT[i][j + 1], (255 - xMix) * yMix],
    [DRUM_MAP_LAYOUT[i + 1][j + 1], xMix * yMix],
  ];

  const out: number[] = [];
  for (const [nodeIndex, weight] of weightedNodes) {
    if (weight > 0 && !out.includes(nodeIndex)) {
      out.push(nodeIndex);
    }
  }
  return out;
}

function readDrumMapLevel(
  step: number,
  instrumentIndex: number,
  x: number,
  y: number,
  nodes: number[][],
): number {
  const safeX = clampNumber(Math.round(x), 0, 255);
  const safeY = clampNumber(Math.round(y), 0, 255);

  const i = safeX >> 6;
  const j = safeY >> 6;

  const aIndex = DRUM_MAP_LAYOUT[i][j];
  const bIndex = DRUM_MAP_LAYOUT[i + 1][j];
  const cIndex = DRUM_MAP_LAYOUT[i][j + 1];
  const dIndex = DRUM_MAP_LAYOUT[i + 1][j + 1];

  const offset = instrumentIndex * STEPS_PER_PATTERN + step;
  const a = readNodeValue(nodes[aIndex], offset);
  const b = readNodeValue(nodes[bIndex], offset);
  const c = readNodeValue(nodes[cIndex], offset);
  const d = readNodeValue(nodes[dIndex], offset);

  const xMix = (safeX << 2) & 0xff;
  const yMix = (safeY << 2) & 0xff;

  return u8Mix(u8Mix(a, b, xMix), u8Mix(c, d, xMix), yMix);
}

export function generatePatternFromFactory(
  knobs: KnobState,
  nodes: number[][],
): PatternState {
  return {
    kick: generateTrack(0, knobs, nodes),
    snare: generateTrack(1, knobs, nodes),
    hihat: generateTrack(2, knobs, nodes),
  };
}

export function generateTrackForInstrument(
  instrument: InstrumentKey,
  knobs: KnobState,
  nodes: number[][],
): StepCell[] {
  const instrumentIndex = { kick: 0, snare: 1, hihat: 2 }[instrument];
  return generateTrack(instrumentIndex, knobs, nodes);
}

function generateTrack(
  instrumentIndex: number,
  knobs: KnobState,
  nodes: number[][],
): StepCell[] {
  const instrument = INSTRUMENTS[instrumentIndex];
  const density = knobs.density[instrument];
  return Array.from({ length: STEPS_PER_PATTERN }, (_, step) => {
    const rawLevel = readDrumMapLevel(step, instrumentIndex, knobs.x, knobs.y, nodes);
    if (rawLevel <= 0) {
      return createEmptyStepCell();
    }
    return makeStepCell({
      active: true,
      density,
      chaos: knobs.chaos,
      level: rawLevel,
      generated: true,
    });
  });
}

export async function fetchFactoryNodes(): Promise<number[][]> {
  return EMBEDDED_FACTORY_NODES.map((node) => [...node]);
}
