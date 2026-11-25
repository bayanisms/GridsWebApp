import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const components = readFileSync('src/components.tsx', 'utf8');
const panels = readFileSync('src/editorPanels.tsx', 'utf8');
const css = readFileSync('src/App.css', 'utf8');

assert(components.includes("accent?: 'orange' | 'green' | 'yellow';"), 'KnobControl must accept a visual accent.');
assert(panels.includes('label="Kick Density"') && panels.includes('accent="orange"'), 'Kick Density must be orange.');
assert(panels.includes('label="Snare Density"') && panels.includes('accent="green"'), 'Snare Density must be green.');
assert(panels.includes('label="Hi-hat Density"') && panels.includes('accent="yellow"'), 'Hi-hat Density must be yellow.');
assert(css.includes('.knob-card.knob-density.knob-yellow .knob-visual'), 'Yellow density knob styling must exist.');

console.log(JSON.stringify({ status: 'ok', checks: 5 }, null, 2));
