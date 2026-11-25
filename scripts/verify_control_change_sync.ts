import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as grids from '../src/grids';

// Execute the real App handlers with state setters in place of React rendering.
// This covers the commit branch, which pure encoding tests do not exercise.
const source = readFileSync('src/App.tsx', 'utf8');
function declaration(start: string, end: string): string {
  const from = source.indexOf(`  const ${start} =`);
  const to = source.indexOf(`  const ${end} =`, from);
  assert(from >= 0 && to > from, `Missing App handler ${start}`);
  return source.slice(from, to);
}
const handlers = [
  declaration('replaceVisiblePattern', 'updateVisiblePattern'),
  declaration('commitPatternToEditableNodes', 'commitCurrentPatternToEditableNodes'),
  declaration('commitCurrentPatternToEditableNodes', 'regenerateFromKnobs'),
  declaration('mergeGeneratedPattern', 'updateKnobs'),
  declaration('updateKnobs', 'updateDensity'),
  declaration('updateDensity', 'updateSoundDesign'),
].join('\n');

function exercise(control: 'density' | 'chaos') {
  const knobs: grids.KnobState = {
    x: 128, y: 128, chaos: 64,
    density: { kick: 192, snare: 144, hihat: 216 },
  };
  const pattern = grids.createPatternFromProgrammedSteps();
  pattern.kick[0] = grids.makeStepCell({
    active: true, density: 192, chaos: 64, velocity: 100,
    chaosChance: control === 'density' ? 100 : 50, generated: false,
  });
  let visible = pattern;
  let saved: number[][] | undefined;
  const patternRef = { current: pattern };
  const editableNodesRef = { current: grids.FALLBACK_FACTORY_NODES.map(node => [...node]) };
  const knobsRef = { current: knobs };
  const bindings = {
    knobsRef, patternRef, editableNodesRef, patternDirtyRef: { current: false },
    setKnobs: (update: (previous: grids.KnobState) => grids.KnobState) => update(knobs),
    setPattern: (next: grids.PatternState) => { visible = next; },
    setEditableNodes: () => {},
    persistEditableNodes: (nodes: number[][]) => { saved = nodes; },
    saveBrowserBankState: () => true,
    cloneNodes: (nodes: number[][]) => nodes.map(node => [...node]),
    nodeDataFromPattern: grids.nodeDataFromPattern,
    interpolationNodeIndicesFromXY: grids.interpolationNodeIndicesFromXY,
    generateTrackForInstrument: grids.generateTrackForInstrument,
    generatePatternFromFactory: grids.generatePatternFromFactory,
    reencodeUserStep: grids.reencodeUserStep,
    INSTRUMENTS: grids.INSTRUMENTS,
  };
  const js = ts.transpileModule(handlers, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText;
  const run = new Function(...Object.keys(bindings), `${js}; return { updateKnobs, updateDensity };`);
  const actions = run(...Object.values(bindings));
  if (control === 'density') actions.updateDensity('kick', 128);
  else actions.updateKnobs((previous: grids.KnobState) => ({ ...previous, chaos: 200 }));
  const expected = grids.reencodeUserStep(pattern.kick[0], knobsRef.current.density.kick, knobsRef.current.chaos);
  assert.notEqual(expected.level, pattern.kick[0].level, 'Fixture must change the encoded level');
  assert.equal(visible.kick[0].level, expected.level, `${control}: visible step is stale`);
  assert.equal(patternRef.current, visible, `${control}: playback ref is stale`);
  assert(saved, `${control}: bank was not saved`);
  assert.deepEqual(saved[4], grids.nodeDataFromPattern(visible), `${control}: exported bank differs from playback`);
}
exercise('density');
exercise('chaos');
console.log('Control changes keep visible steps, playback, and saved bank synchronized.');
