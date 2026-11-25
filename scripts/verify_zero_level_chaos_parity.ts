import assert from 'node:assert/strict';
import type { DrumSynth909 } from '../src/audio808';
import {
  classifyStepTrigger, createEmptyStepCell, createPatternFromProgrammedSteps,
  fireProbability, hardwareTriggered, isStepTriggered, samplePartPerturbation,
} from '../src/grids';
import { startPlaybackScheduler, type PlaybackSchedulerState } from '../src/playbackScheduler';

// Independent transcription of EvaluateDrums, including its zero-byte behavior.
for (const density of [0, 128, 192, 240, 255]) {
  let hits = 0;
  for (let randomByte = 0; randomByte < 256; randomByte++) {
    const boost = (randomByte * 63) >> 8;
    const firmwareFires = Math.min(255, boost) > (255 - density);
    assert.equal(hardwareTriggered(0, density, boost), firmwareFires);
    if (firmwareFires) hits++;
  }
  assert.equal(fireProbability(0, density, 255), hits / 256);
}
const cleared = createEmptyStepCell();
assert.equal(classifyStepTrigger(cleared, 240, 255), 'chaos-sensitive');
assert.equal(isStepTriggered(cleared, 240, 255), true);
assert.equal(classifyStepTrigger(cleared, 240, 0), 'off');
assert.equal(isStepTriggered(cleared, 240, 0), false);

const state: PlaybackSchedulerState = {
  bpm: 120,
  knobs: { x: 128, y: 128, chaos: 255, density: { kick: 255, snare: 255, hihat: 255 } },
  pattern: createPatternFromProgrammedSteps(),
  soundDesign: { kick: { tone: 64, filter: 64, decay: 64 }, snare: { tone: 64, filter: 64, decay: 64 }, hihat: { tone: 64, filter: 64, decay: 64 } },
};
let now = 0;
let triggers = 0;
let timerId = 0;
let tick = () => {};
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  setTimeout: () => ++timerId, clearTimeout: () => {},
  setInterval: (callback: () => void) => { tick = callback; return ++timerId; },
  clearInterval: () => {},
} });
const synth = {
  getAudioContext: () => ({ get currentTime() { return now; } }),
  triggerAtTime: () => { triggers++; },
} as unknown as DrumSynth909;
const originalNow = Date.now;
Date.now = () => 123456; // Reproducible bar Chaos.
try {
  const controller = startPlaybackScheduler(synth, 0, () => state, { onStep: () => {} });
  for (let i = 0; i < 100; i++) { now += 0.025; tick(); }
  controller.stop();
  assert(triggers > 0, 'Cleared map bytes must receive Chaos in the scheduler');
  state.knobs.chaos = 0;
  triggers = 0;
  const silent = startPlaybackScheduler(synth, 0, () => state, { onStep: () => {} });
  for (let i = 0; i < 100; i++) { now += 0.025; tick(); }
  silent.stop();
  assert.equal(triggers, 0, 'Cleared steps must stay silent without Chaos');
  assert.equal(samplePartPerturbation(63, 255), 62);
} finally {
  Date.now = originalNow;
  if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
  else Reflect.deleteProperty(globalThis, 'window');
}
console.log('Zero-byte Chaos behavior matches firmware and browser scheduling.');
