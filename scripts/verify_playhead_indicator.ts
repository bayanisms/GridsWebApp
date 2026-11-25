import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const panels = readFileSync('src/editorPanels.tsx', 'utf8');
const css = readFileSync('src/App.css', 'utf8');
const scheduler = readFileSync('src/playbackScheduler.ts', 'utf8');

assert(
  panels.includes("isPlayingStep ? 'playhead' : ''"),
  'The active step must receive the playhead class while playback is running.',
);
assert(
  scheduler.includes('callbacks.onStep(step)'),
  'The playback scheduler must publish each current step to the UI.',
);
assert(
  css.includes('.step-button.playhead::before'),
  'The playhead must have an explicit visual overlay, not only a subtle shadow.',
);
assert(
  css.includes('border: 3px solid #f7ff1f'),
  'The playhead overlay must use a high-contrast indicator border.',
);

console.log(JSON.stringify({ status: 'ok', checks: 4 }, null, 2));
