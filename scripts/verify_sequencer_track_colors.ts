import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const panels = readFileSync('src/editorPanels.tsx', 'utf8');
const css = readFileSync('src/App.css', 'utf8');

assert(panels.includes('track-row track-${instrument}'), 'Each sequencer track must expose its instrument class.');
assert(css.includes('.track-row.track-snare { --track-accent: var(--green); }'), 'Snare must use green.');
assert(css.includes('.track-row.track-hihat { --track-accent: var(--yellow); }'), 'Hi-hat must use yellow.');
assert(css.includes('background: var(--track-accent);'), 'Step velocity bars must use the track accent.');

console.log(JSON.stringify({ status: 'ok', checks: 4 }, null, 2));
