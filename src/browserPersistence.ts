import type { KnobState } from './grids';

const STORAGE_KEY = 'gridswebapp.browserBank.v3';
const STORAGE_VERSION = 3;
const NODE_COUNT = 25;
const NODE_BYTES = 96;

export interface BrowserBankState {
  version: typeof STORAGE_VERSION;
  savedAt: string;
  editableNodes: number[][];
  knobs?: KnobState;
}

function normalizeByte(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function normalizeBrowserNodeBank(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length !== NODE_COUNT) {
    return null;
  }

  const nodes: number[][] = [];
  for (const node of value) {
    if (!Array.isArray(node) || node.length !== NODE_BYTES) {
      return null;
    }
    const normalizedNode: number[] = [];
    for (const entry of node) {
      const normalized = normalizeByte(entry);
      if (normalized === null) {
        return null;
      }
      normalizedNode.push(normalized);
    }
    nodes.push(normalizedNode);
  }
  return nodes;
}

function normalizeKnobs(value: unknown): KnobState | undefined {
  if (typeof value !== 'object' || value === null || !('density' in value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const density = record.density as Record<string, unknown> | undefined;
  if (typeof density !== 'object' || density === null) {
    return undefined;
  }

  const x = normalizeByte(record.x);
  const y = normalizeByte(record.y);
  const chaos = normalizeByte(record.chaos);
  const kick = normalizeByte(density.kick);
  const snare = normalizeByte(density.snare);
  const hihat = normalizeByte(density.hihat);
  if (x === null || y === null || chaos === null || kick === null || snare === null || hihat === null) {
    return undefined;
  }
  return {
    x,
    y,
    chaos,
    density: { kick, snare, hihat },
  };
}

function storage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadBrowserBankState(): BrowserBankState | null {
  const target = storage();
  if (!target) {
    return null;
  }

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== STORAGE_VERSION) {
      return null;
    }
    const editableNodes = normalizeBrowserNodeBank(parsed.editableNodes);
    if (!editableNodes) {
      return null;
    }
    return {
      version: STORAGE_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
      editableNodes,
      knobs: normalizeKnobs(parsed.knobs),
    };
  } catch {
    return null;
  }
}

export function saveBrowserBankState(state: Pick<BrowserBankState, 'editableNodes'> & { knobs?: KnobState }): boolean {
  const target = storage();
  if (!target) {
    return false;
  }
  const editableNodes = normalizeBrowserNodeBank(state.editableNodes);
  if (!editableNodes) {
    return false;
  }

  const payload: BrowserBankState = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    editableNodes,
    knobs: state.knobs,
  };

  try {
    target.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function resetBrowserBankState(): void {
  const target = storage();
  if (!target) {
    return;
  }
  try {
    target.removeItem(STORAGE_KEY);
  } catch {
    // Ignore browsers that block storage writes.
  }
}
