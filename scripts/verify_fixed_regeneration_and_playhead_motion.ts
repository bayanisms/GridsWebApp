import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const app = readFileSync('src/App.tsx', 'utf8');
const panels = readFileSync('src/editorPanels.tsx', 'utf8');
const css = readFileSync('src/App.css', 'utf8');

assert(!app.includes('autoRegenerate'), 'Regeneration must not be user-toggleable in App state.');
assert(!panels.includes('Auto-regenerate'), 'The Auto-regenerate control must not be rendered.');
assert(panels.includes('playhead-guide'), 'Playing tracks must render a motion guide.');
assert(css.includes('.playhead-guide'), 'The motion guide must have a dedicated visual style.');
assert(css.includes('transition: left 45ms linear'), 'The playhead guide must glide linearly between steps.');

console.log(JSON.stringify({ status: 'ok', checks: 5 }, null, 2));
