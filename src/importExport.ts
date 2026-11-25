import {
  INSTRUMENTS,
  STEPS_PER_PATTERN,
  clampNumber,
  makeStepCell,
  strengthFromLevel,
  type StepStrength,
  type InstrumentKey,
  type KnobState,
  type PatternState,
  type StepCell,
} from './grids';
import type { DrumVoiceDesign } from './audio808';

export type SoundDesignState = Record<InstrumentKey, DrumVoiceDesign>;

export interface NormalizedImport {
  knobs: KnobState | null;
  pattern: PatternState | null;
  editableNodes: number[][] | null;
  bpm: number | null;
  masterVolume: number | null;
  channelLevels: Record<InstrumentKey, number> | null;
  soundDesign: SoundDesignState | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readFiniteNumber(value: unknown): number | null {
  const candidate =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeNumber(value: unknown, min: number, max: number): number | null {
  const numeric = readFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return clampNumber(Math.round(numeric), min, max);
}

function normalizeStepCell(value: unknown): StepCell | null {
  if (typeof value === 'boolean') {
    return makeStepCell({ active: value, density: 192, generated: false });
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) {
      return makeStepCell({ active: false, density: 192, generated: false });
    }

    const level = value <= 1 ? Math.round(value * 255) : Math.round(value);
    return makeStepCell({
      active: true,
      density: 192,
      strength: strengthFromLevel(level),
      level,
      velocity: Math.max(1, Math.round((clampNumber(level, 1, 255) / 255) * 127)),
      generated: false,
    });
  }

  if (!isRecord(value)) {
    return null;
  }
  const rawStrength = typeof value.strength === 'string' ? value.strength : null;
  const strength: StepStrength = rawStrength === 'soft' || rawStrength === 'normal' || rawStrength === 'accent'
    ? rawStrength
    : 'normal';

  if ('active' in value || 'level' in value) {
    const active = Boolean(value.active);
    const level = normalizeNumber(value.level, 0, 255) ?? undefined;
    const velocity = normalizeNumber(value.velocity, 0, 127) ?? undefined;
    const chaosChance = normalizeNumber(value.chaosChance ?? value.chance, 0, 100) ?? undefined;
    return makeStepCell({
      active,
      density: 192,
      chaos: 64,
      strength,
      level,
      velocity,
      chaosChance,
      generated: typeof value.generated === 'boolean' ? value.generated : false,
    });
  }

  const enabled = Boolean(value.enabled);
  const velocity = normalizeNumber(value.velocity, 0, 127) ?? (enabled ? 100 : 0);
  const chance = normalizeNumber(value.chance ?? value.chaosChance, 0, 100) ?? (enabled ? 100 : 0);
  return makeStepCell({
    active: enabled,
    density: 192,
    chaos: 64,
    strength,
    velocity: enabled ? Math.max(1, velocity) : undefined,
    chaosChance: chance,
    generated: false,
  });
}

function normalizePattern(value: unknown): PatternState | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Partial<PatternState> = {};
  for (const instrument of INSTRUMENTS) {
    const row = value[instrument];
    if (!Array.isArray(row) || row.length !== STEPS_PER_PATTERN) {
      return null;
    }
    const cells: StepCell[] = [];
    for (const cell of row) {
      const normalizedCell = normalizeStepCell(cell);
      if (!normalizedCell) {
        return null;
      }
      cells.push(normalizedCell);
    }
    normalized[instrument] = cells;
  }

  return normalized as PatternState;
}

function normalizeEditableNodes(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length < 25) {
    return null;
  }

  const nodes: number[][] = [];
  for (let nodeIndex = 0; nodeIndex < 25; nodeIndex += 1) {
    const node = value[nodeIndex];
    if (!Array.isArray(node) || node.length !== 96) {
      return null;
    }
    const normalizedNode: number[] = [];
    for (const entry of node) {
      const normalized = normalizeNumber(entry, 0, 255);
      if (normalized === null) {
        return null;
      }
      normalizedNode.push(normalized);
    }
    nodes.push(normalizedNode);
  }
  return nodes;
}

export function normalizePatternFromAny(value: unknown): PatternState | null {
  const direct = normalizePattern(value);
  if (direct) {
    return direct;
  }

  if (isRecord(value) && 'pattern' in value) {
    return normalizePattern(value.pattern);
  }

  if (Array.isArray(value) && value.length === INSTRUMENTS.length) {
    const asRecord: Record<InstrumentKey, unknown> = {
      kick: value[0],
      snare: value[1],
      hihat: value[2],
    };
    return normalizePattern(asRecord);
  }

  return null;
}

function normalizeKnobs(value: unknown): KnobState | null {
  if (!isRecord(value) || !isRecord(value.density)) {
    return null;
  }

  const x = normalizeNumber(value.x, 0, 255);
  const y = normalizeNumber(value.y, 0, 255);
  const chaos = normalizeNumber(value.chaos, 0, 255);
  const kick = normalizeNumber(value.density.kick, 0, 255);
  const snare = normalizeNumber(value.density.snare, 0, 255);
  const hihat = normalizeNumber(value.density.hihat, 0, 255);

  if (
    x === null ||
    y === null ||
    chaos === null ||
    kick === null ||
    snare === null ||
    hihat === null
  ) {
    return null;
  }

  return {
    x,
    y,
    chaos,
    density: {
      kick,
      snare,
      hihat,
    },
  };
}

function normalizeChannelLevels(value: unknown): Record<InstrumentKey, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Partial<Record<InstrumentKey, number>> = {};
  for (const instrument of INSTRUMENTS) {
    const level = readFiniteNumber(value[instrument]);
    if (level === null) {
      return null;
    }
    normalized[instrument] = clampNumber(level, 0, 1);
  }

  return normalized as Record<InstrumentKey, number>;
}

function normalizeSoundDesign(value: unknown, defaults: SoundDesignState): SoundDesignState | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Partial<SoundDesignState> = {};
  for (const instrument of INSTRUMENTS) {
    const entry = value[instrument];
    if (!isRecord(entry)) {
      return null;
    }
    const tone = normalizeNumber(entry.tone, 0, 127);
    const filter = normalizeNumber(entry.filter, 0, 127) ?? defaults[instrument].filter;
    const decay = normalizeNumber(entry.decay, 0, 127);
    if (tone === null || decay === null) {
      return null;
    }
    normalized[instrument] = {
      tone,
      filter,
      decay,
    };
  }

  return normalized as SoundDesignState;
}

export function normalizeImportedJson(
  raw: unknown,
  defaultSoundDesign: SoundDesignState,
): NormalizedImport | null {
  if (!isRecord(raw)) {
    return null;
  }

  let bpm: number | null = null;
  let masterVolume: number | null = null;
  let channelLevels: Record<InstrumentKey, number> | null = null;
  if (isRecord(raw.transport)) {
    bpm = normalizeNumber(raw.transport.bpm, 20, 240);
    const volume = readFiniteNumber(raw.transport.masterVolume);
    masterVolume = volume === null ? null : clampNumber(volume, 0, 1);
    channelLevels = normalizeChannelLevels(raw.transport.channelLevels);
  }

  const soundDesign =
    normalizeSoundDesign(raw.soundDesign, defaultSoundDesign) ||
    (isRecord(raw.transport)
      ? normalizeSoundDesign(raw.transport.soundDesign, defaultSoundDesign)
      : null);

  return {
    knobs: normalizeKnobs(raw.knobs),
    pattern: normalizePattern(raw.pattern),
    editableNodes: normalizeEditableNodes(raw.editableNodes),
    bpm,
    masterVolume,
    channelLevels,
    soundDesign,
  };
}
