import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = readFileSync('src/App.tsx', 'utf8');
const css = readFileSync('src/App.css', 'utf8');

assert(app.includes('<h2>Playback and Sound Design</h2>'), 'Playback panel heading must use the shorter name.');
assert(css.includes('.sound-design-card:nth-child(2) h3 { color: var(--green); }'), 'Snare Sound heading must be green.');
assert(css.includes('.sound-design-card:nth-child(3) h3 { color: var(--yellow); }'), 'Hi-hat Sound heading must be yellow.');
assert(css.includes('.topbar-panel {\n  grid-column: span 4;\n  grid-row: 2;\n  align-self: stretch;'), 'Playback panel must stretch to the upper-bay row height.');
assert(css.includes('grid-template-rows: auto auto 1fr;'), 'Playback panel must reserve remaining height for the sound controls.');

console.log(JSON.stringify({ status: 'ok', checks: 5 }, null, 2));
