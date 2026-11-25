import { readFileSync } from 'node:fs';
import {
  createPatternFromProgrammedSteps,
  densityThreshold,
  makeStepCell,
  nodeDataFromPattern,
} from '../src/grids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const pattern = createPatternFromProgrammedSteps();
const density = 128;
const chaos = 180;
const cell = makeStepCell({
  active: true,
  density,
  chaos,
  velocity: 100,
  chaosChance: 55,
  generated: false,
});
pattern.kick[0] = cell;

const nodeData = nodeDataFromPattern(pattern);
assert(
  nodeData[0] === cell.level,
  `export must keep encoded map level; expected ${cell.level}, got ${nodeData[0]}`,
);
assert(cell.level > 0, 'chance-encoded step must have non-zero map level');
assert(cell.level <= densityThreshold(density), '55% chance should sit at or below threshold (chaos-sensitive)');

const app = readFileSync('src/App.tsx', 'utf8');
assert(
  app.includes('const mapPositionChanged = next.x !== previous.x || next.y !== previous.y;'),
  'updateKnobs must explicitly detect X/Y movement',
);
assert(
  app.includes('if (mapPositionChanged) {'),
  'only X/Y movement may regenerate the full pattern; Chaos changes must preserve it',
);
assert(
  app.includes('reencodeUserStep'),
  'user velocity/chance must re-encode into map levels when Density/Chaos change',
);

console.log(JSON.stringify({
  status: 'ok',
  savedLevel: nodeData[0],
  chaosChance: cell.chaosChance,
  threshold: densityThreshold(density),
}, null, 2));
