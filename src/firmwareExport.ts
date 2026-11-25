import { OFFICIAL_GRIDS_FSK_OPTIONS, OFFICIAL_GRIDS_STOCK_WAV_URL } from './avrAudioBootloader';
import { clampNumber, type InstrumentKey, type KnobState, type PatternState } from './grids';
import type { SoundDesignState } from './importExport';

export const LOOKUP_TABLES_PY_TRAILER = `for i, p in enumerate(nodes):
  drum_map_nodes.append(('%d' % i, p))


"""----------------------------------------------------------------------------
Euclidean patterns
----------------------------------------------------------------------------"""

def Flatten(l):
  if hasattr(l, 'pop'):
    for item in l:
      for j in Flatten(item):
        yield j
  else:
    yield l


def EuclidianPattern(k, n):
  pattern = [[1]] * k + [[0]] * (n - k)
  while k:
    cut = min(k, len(pattern) - k)
    k, pattern = cut, [pattern[i] + pattern[k + i] for i in range(cut)] + \\
      pattern[cut:k] + pattern[k + cut:]
  return pattern


table = []
for num_steps in range(1, 33):
  for num_notes in range(32):
    num_notes = int(round(float(num_notes) / 31 * num_steps))
    bitmask = 0
    for i, bit in enumerate(Flatten(EuclidianPattern(num_notes, num_steps))):
      if bit:
        bitmask |= (1 << i)
    table.append(bitmask)

lookup_tables32 = [('euclidean', table)]



"""----------------------------------------------------------------------------
Phase increment for tempo.
----------------------------------------------------------------------------"""

control_rate = 8000
width = 1 << 32
tempo_values = numpy.arange(0, 512.0)
lookup_tables32.append(
    ('tempo_phase_increment', width * tempo_values * 8 / (60 * control_rate) / 2)
)
`;

export interface FirmwareSnapshotInput {
  bpm: number;
  masterVolume: number;
  channelLevels: Record<InstrumentKey, number>;
  soundDesign: SoundDesignState;
  pattern: PatternState;
  knobs: KnobState;
  editableNodes: number[][];
  factoryStatus: 'loading' | 'live' | 'fallback';
  patchedNodeIndices: number[];
  sourceFirmwareInfo: {
    sha256: string;
    byteLength?: number;
    length?: number;
    bundledAssetUrl?: string;
    sourceWavUrl?: string;
  };
}

function formatNodeRowsForPython(node: number[], rowSize = 8): string[] {
  if (node.length !== 96) {
    throw new Error('Each Grids node must contain exactly 96 bytes.');
  }
  const rows: string[] = [];
  for (let offset = 0; offset < node.length; offset += rowSize) {
    const row = node
      .slice(offset, offset + rowSize)
      .map((value) => clampNumber(Math.round(value), 0, 255).toString());
    rows.push(`\t${row.join(', ')},`);
  }
  return rows;
}

export function buildLookupTablesPython(
  nodes: number[][],
  generatedAt: string,
  targetNodeIndex: number,
  patchedNodeIndices: number[],
): string {
  if (nodes.length < 25) {
    throw new Error('Factory node table is incomplete; expected at least 25 nodes.');
  }

  const lines: string[] = [
    '#!/usr/bin/python2.5',
    '#',
    '# Copyright 2012 Emilie Gillet.',
    '#',
    '# Author: Emilie Gillet (emilie.o.gillet@gmail.com)',
    '#',
    '# This file was exported by GridsWebApp.',
    `# Generated at: ${generatedAt}`,
    `# Active XY node: ${targetNodeIndex}`,
    `# Patched node indices: ${patchedNodeIndices.length ? patchedNodeIndices.join(', ') : 'none'}`,
    '#',
    '# ----------------------------------------------------------------------------',
    '#',
    '# Lookup table definitions.',
    '',
    'import numpy',
    '',
    'lookup_tables = []',
    'drum_map_nodes = []',
    '',
    '"""----------------------------------------------------------------------------',
    'Drum map nodes',
    '----------------------------------------------------------------------------"""',
    '',
    'nodes = [',
  ];

  for (let nodeIndex = 0; nodeIndex < 25; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    lines.push('[');
    lines.push(...formatNodeRowsForPython(node));
    lines.push('],');
  }

  lines.push(']');
  lines.push('');
  lines.push(LOOKUP_TABLES_PY_TRAILER.trimEnd());
  lines.push('');
  return lines.join('\n');
}

export function buildFirmwarePatchSnapshot(input: FirmwareSnapshotInput) {
  const length = input.sourceFirmwareInfo.byteLength ?? input.sourceFirmwareInfo.length ?? 0;
  return {
    schema: 'grids-webapp-firmware-patch-v1',
    generatedAt: new Date().toISOString(),
    sourceFirmware: {
      type: 'embedded-stock-binary',
      sourceWavUrl: input.sourceFirmwareInfo.sourceWavUrl ?? OFFICIAL_GRIDS_STOCK_WAV_URL,
      sha256: input.sourceFirmwareInfo.sha256,
      byteLength: length,
      bundledAssetUrl: input.sourceFirmwareInfo.bundledAssetUrl,
    },
    factorySource:
      input.factoryStatus === 'live'
        ? 'Mutable Instruments lookup_tables.py'
        : 'local embedded factory nodes',
    knobs: input.knobs,
    transport: {
      bpm: input.bpm,
      masterVolume: input.masterVolume,
      channelLevels: input.channelLevels,
    },
    soundDesign: input.soundDesign,
    pattern: input.pattern,
    editableNodes: input.editableNodes,
    patchPlan: {
      nodePatches: input.patchedNodeIndices,
      exportsAllEditorState: true,
      metadataEmbeddedInFlash: false,
    },
    audioBootloaderExport: {
      protocol: 'avr-audio-bootloader-fsk',
      module: 'grids',
      options: OFFICIAL_GRIDS_FSK_OPTIONS,
    },
  };
}
