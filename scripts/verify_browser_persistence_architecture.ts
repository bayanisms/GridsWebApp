import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = readFileSync('src/App.tsx', 'utf8');
const editorPanels = readFileSync('src/editorPanels.tsx', 'utf8');
const persistenceExists = (() => {
  try {
    readFileSync('src/browserPersistence.ts', 'utf8');
    return true;
  } catch {
    return false;
  }
})();

assert(
  app.includes('const nextPattern = updater(patternRef.current);'),
  'updateVisiblePattern must synchronously update patternRef/patternDirtyRef from patternRef.current before React state flushes',
);
assert(
  !app.includes('setPattern((previous) => {\n      const nextPattern = updater(previous);'),
  'updateVisiblePattern must not rely on async functional setPattern for dirty commits before X/Y movement',
);
assert(persistenceExists, 'App must have browser persistence utilities for bank/session storage');
assert(app.includes('loadBrowserBankState'), 'App must load saved browser bank state on startup');
assert(app.includes('saveBrowserBankState'), 'App must save edited bank state after user changes/commits/imports');
assert(app.includes('resetBrowserBankState'), 'App must expose a reset path that clears saved browser bank state');
assert(editorPanels.includes('Reset bank to defaults'), 'UI must include a reset bank button');
assert(
  app.includes('browserBankMutatedRef.current'),
  'async factory loading must not overwrite clear/random/import edits made during startup',
);

console.log(JSON.stringify({ status: 'ok', checks: 8 }, null, 2));
