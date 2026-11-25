import type { DrumSynth909, DrumVoiceDesign } from './audio808';
import {
  clampNumber,
  hardwareTriggered,
  mapLevelForCell,
  INSTRUMENTS,
  samplePartPerturbation,
  chaosRandomness,
  playbackGainFromLevel,
  STEPS_PER_PATTERN,
  type InstrumentKey,
  type KnobState,
  type PatternState,
} from './grids';
import { createDeterministicPrng } from './utils';

const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_TICK_MS = 25;
const GRIDS_STEPS_PER_QUARTER_NOTE = 8;

export interface PlaybackSchedulerState {
  bpm: number;
  knobs: KnobState;
  pattern: PatternState;
  soundDesign: Record<InstrumentKey, DrumVoiceDesign>;
}

export interface PlaybackSchedulerCallbacks {
  onStep: (step: number) => void;
}

export interface PlaybackSchedulerController {
  stop: () => void;
}

/**
 * Playback mirrors Grids EvaluateDrums exactly:
 * - bar-hold part_perturbation from Chaos
 * - fire when map level + boost > ~density
 * - hit loudness from map level (same byte hardware uses for accent > 192)
 */
export function startPlaybackScheduler(
  synth: DrumSynth909,
  initialStep: number,
  getState: () => PlaybackSchedulerState,
  callbacks: PlaybackSchedulerCallbacks,
): PlaybackSchedulerController {
  const context = synth.getAudioContext();
  let disposed = false;
  let nextStep = initialStep;
  let nextNoteTime = context.currentTime;
  let playheadTimers = new Set<number>();
  let lastAnnouncedStep = -1;
  const random = createDeterministicPrng((Date.now() ^ (initialStep << 8)) >>> 0);
  const partPerturbation: Record<InstrumentKey, number> = {
    kick: 0,
    snare: 0,
    hihat: 0,
  };

  const clearPlayheadTimers = () => {
    for (const timer of playheadTimers) {
      window.clearTimeout(timer);
    }
    playheadTimers = new Set();
  };

  const schedulePlayheadUpdate = (step: number, eventTime: number) => {
    const delayMs = Math.max(0, (eventTime - context.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      playheadTimers.delete(timer);
      if (!disposed) {
        callbacks.onStep(step);
      }
    }, delayMs);
    playheadTimers.add(timer);
  };

  const rerollPatternChaos = (chaos: number) => {
    const randomness = chaosRandomness(chaos);
    for (const instrument of INSTRUMENTS) {
      const randomByte = Math.floor(random() * 256) & 0xff;
      partPerturbation[instrument] = samplePartPerturbation(randomness, randomByte);
    }
  };

  rerollPatternChaos(getState().knobs.chaos);

  const scheduleStep = (step: number, stepTime: number) => {
    const { knobs, pattern, soundDesign } = getState();
    if (step === 0) {
      rerollPatternChaos(knobs.chaos);
    }

    if (step !== lastAnnouncedStep) {
      schedulePlayheadUpdate(step, stepTime);
      lastAnnouncedStep = step;
    }

    for (const instrument of INSTRUMENTS) {
      const cell = pattern[instrument][step];
      // In stock firmware even a cleared map byte receives the bar's Chaos boost.
      const level = mapLevelForCell(cell);
      if (!hardwareTriggered(level, knobs.density[instrument], partPerturbation[instrument])) {
        continue;
      }

      // Gain from map level — same byte the module uses (accent when level > 192).
      synth.triggerAtTime(
        instrument,
        clampNumber(playbackGainFromLevel(level), 0.05, 1),
        soundDesign[instrument],
        stepTime,
      );
    }
  };

  const scheduler = () => {
    if (disposed) {
      return;
    }

    while (nextNoteTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const { bpm } = getState();
      const stepLengthSeconds = (60 / bpm) / GRIDS_STEPS_PER_QUARTER_NOTE;
      scheduleStep(nextStep, nextNoteTime);
      nextStep = (nextStep + 1) % STEPS_PER_PATTERN;
      nextNoteTime += stepLengthSeconds;
    }
  };

  scheduler();
  const intervalId = window.setInterval(scheduler, SCHEDULER_TICK_MS);

  return {
    stop: () => {
      disposed = true;
      window.clearInterval(intervalId);
      clearPlayheadTimers();
    },
  };
}
