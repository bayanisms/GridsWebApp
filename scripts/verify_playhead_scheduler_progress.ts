import type { DrumSynth909 } from '../src/audio808';
import {
  startPlaybackScheduler,
  type PlaybackSchedulerState,
} from '../src/playbackScheduler';
import type { InstrumentKey, PatternState } from '../src/grids';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const steps: number[] = [];
const timeouts = new Map<number, { callback: () => void; at: number }>();
const intervals: Array<() => void> = [];
let now = 0;
let nextTimerId = 0;

const fakeWindow = {
  setTimeout(callback: () => void, delay = 0) {
    const id = ++nextTimerId;
    timeouts.set(id, { callback, at: now + delay / 1000 });
    return id;
  },
  clearTimeout(id: number) {
    timeouts.delete(id);
  },
  setInterval(callback: () => void) {
    intervals.push(callback);
    return ++nextTimerId;
  },
  clearInterval() {},
};

Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

const emptyTrack = () => Array.from({ length: 32 }, () => ({ active: false, level: 0 }));
const state: PlaybackSchedulerState = {
  bpm: 120,
  knobs: {
    x: 128,
    y: 128,
    chaos: 0,
    density: { kick: 128, snare: 128, hihat: 128 },
  },
  pattern: {
    kick: emptyTrack(),
    snare: emptyTrack(),
    hihat: emptyTrack(),
  } as PatternState,
  soundDesign: {} as Record<InstrumentKey, never>,
};

const context = { get currentTime() { return now; } };
const synth = {
  getAudioContext: () => context,
  triggerAtTime: () => undefined,
} as unknown as DrumSynth909;

const runDueTimers = () => {
  for (const [id, timer] of [...timeouts]) {
    if (timer.at <= now) {
      timeouts.delete(id);
      timer.callback();
    }
  }
};

const tick = (time: number) => {
  now = time;
  for (const interval of intervals) {
    interval();
  }
  runDueTimers();
};

const controller = startPlaybackScheduler(synth, 0, () => state, { onStep: (step) => steps.push(step) });
runDueTimers();
tick(0.025);
tick(0.05);
tick(0.075);
tick(0.1);
tick(0.125);
controller.stop();

assertEqual(steps.slice(0, 3).join(','), '0,1,2', 'Playhead must announce consecutive scheduled steps');
console.log(JSON.stringify({ status: 'ok', steps }, null, 2));
