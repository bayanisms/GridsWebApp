import type { InstrumentKey } from './grids';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const size = context.sampleRate;
  const buffer = context.createBuffer(1, size, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export interface DrumVoiceDesign {
  tone: number;
  filter: number;
  decay: number;
}

function normalized(value: number): number {
  return clamp(value, 0, 127) / 127;
}

function expRange(min: number, max: number, amount: number): number {
  const safeAmount = clamp(amount, 0, 1);
  return min * Math.pow(max / min, safeAmount);
}

function createSaturationCurve(amount: number): Float32Array {
  const curve = new Float32Array(2048);
  const drive = clamp(amount, 0.2, 10);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive);
  }
  return curve;
}

export class DrumSynth909 {
  private context: AudioContext | null = null;

  private masterGain: GainNode | null = null;

  private channelGains: Record<InstrumentKey, GainNode> | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private currentChannelLevels: Record<InstrumentKey, number> = {
    kick: 0.95,
    snare: 0.85,
    hihat: 0.7,
  };

  private ensureContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    const context = new AudioContext({ latencyHint: 'interactive' });
    const gain = context.createGain();
    const drive = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();

    const kickChannel = context.createGain();
    const snareChannel = context.createGain();
    const hihatChannel = context.createGain();

    kickChannel.gain.value = this.currentChannelLevels.kick;
    snareChannel.gain.value = this.currentChannelLevels.snare;
    hihatChannel.gain.value = this.currentChannelLevels.hihat;

    const saturationCurve = createSaturationCurve(2.5);
    const saturationCurveCopy = new Float32Array(saturationCurve.length);
    saturationCurveCopy.set(saturationCurve);
    drive.curve = saturationCurveCopy;
    drive.oversample = '4x';

    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.1;

    gain.gain.value = 0.8;

    kickChannel.connect(drive);
    snareChannel.connect(drive);
    hihatChannel.connect(drive);
    drive.connect(compressor);
    compressor.connect(gain);
    gain.connect(context.destination);

    this.context = context;
    this.masterGain = gain;
    this.channelGains = {
      kick: kickChannel,
      snare: snareChannel,
      hihat: hihatChannel,
    };
    this.noiseBuffer = createNoiseBuffer(context);
    return context;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
  }

  getAudioContext(): AudioContext {
    return this.ensureContext();
  }

  setMasterVolume(volume: number): void {
    const context = this.ensureContext();
    const target = clamp(volume, 0, 1);
    this.masterGain?.gain.setTargetAtTime(target, context.currentTime, 0.01);
  }

  setChannelLevels(levels: Record<InstrumentKey, number>): void {
    this.currentChannelLevels = {
      kick: clamp(levels.kick, 0, 1),
      snare: clamp(levels.snare, 0, 1),
      hihat: clamp(levels.hihat, 0, 1),
    };
    const context = this.ensureContext();
    if (!this.channelGains) {
      return;
    }
    this.channelGains.kick.gain.setTargetAtTime(this.currentChannelLevels.kick, context.currentTime, 0.01);
    this.channelGains.snare.gain.setTargetAtTime(
      this.currentChannelLevels.snare,
      context.currentTime,
      0.01,
    );
    this.channelGains.hihat.gain.setTargetAtTime(
      this.currentChannelLevels.hihat,
      context.currentTime,
      0.01,
    );
  }

  trigger(instrument: InstrumentKey, velocity: number, design: DrumVoiceDesign): void {
    const context = this.ensureContext();
    const now = context.currentTime;
    this.triggerAtTime(instrument, velocity, design, now);
  }

  triggerAtTime(
    instrument: InstrumentKey,
    velocity: number,
    design: DrumVoiceDesign,
    time: number,
  ): void {
    const context = this.ensureContext();
    if (!this.channelGains) {
      return;
    }
    const amplitude = clamp(velocity, 0.01, 1);

    switch (instrument) {
      case 'kick':
        this.triggerKick(context, time, amplitude, design, this.channelGains.kick);
        break;
      case 'snare':
        this.triggerSnare(context, time, amplitude, design, this.channelGains.snare);
        break;
      case 'hihat':
        this.triggerHihat(context, time, amplitude, design, this.channelGains.hihat);
        break;
      default:
        break;
    }
  }

  private triggerKick(
    context: AudioContext,
    time: number,
    amplitude: number,
    design: DrumVoiceDesign,
    output: GainNode,
  ): void {
    if (!this.noiseBuffer) {
      return;
    }

    const tone = normalized(design.tone);
    const filter = normalized(design.filter);
    const decay = normalized(design.decay);

    const decayTime = 0.12 + decay * 0.48;
    const startFreq = expRange(155, 280, tone);
    const endFreq = expRange(35, 55, tone * 0.6 + 0.2);
    const sweepTime = 0.008 + tone * 0.03;

    const osc = context.createOscillator();
    const oscGain = context.createGain();
    const lowpass = context.createBiquadFilter();
    const clickNoise = context.createBufferSource();
    const clickBandpass = context.createBiquadFilter();
    const clickGain = context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + sweepTime);
    osc.frequency.setValueAtTime(endFreq, time + sweepTime);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(28, endFreq * 0.92),
      time + decayTime,
    );

    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.exponentialRampToValueAtTime(amplitude * 1.8, time + 0.001);
    oscGain.gain.setValueAtTime(amplitude * 1.8, time + sweepTime);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + decayTime);

    lowpass.type = 'lowpass';
    lowpass.frequency.value = expRange(80, 5000, filter);
    lowpass.Q.value = 0.5 + filter * 2;

    clickNoise.buffer = this.noiseBuffer;
    clickBandpass.type = 'bandpass';
    clickBandpass.frequency.value = expRange(800, 2400, filter * 0.6 + 0.3);
    clickBandpass.Q.value = 1.5;
    clickGain.gain.setValueAtTime(amplitude * 0.45, time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.008);

    osc.connect(oscGain);
    oscGain.connect(lowpass);
    lowpass.connect(output);

    clickNoise.connect(clickBandpass);
    clickBandpass.connect(clickGain);
    clickGain.connect(output);

    osc.start(time);
    clickNoise.start(time);
    osc.stop(time + decayTime + 0.05);
    clickNoise.stop(time + 0.015);
  }

  private triggerSnare(
    context: AudioContext,
    time: number,
    amplitude: number,
    design: DrumVoiceDesign,
    output: GainNode,
  ): void {
    if (!this.noiseBuffer) {
      return;
    }

    const tone = normalized(design.tone);
    const filter = normalized(design.filter);
    const decay = normalized(design.decay);

    const noiseDecay = 0.08 + decay * 0.35;
    const toneDecay = 0.05 + decay * 0.18;

    const noise = context.createBufferSource();
    const noiseHp = context.createBiquadFilter();
    const noiseGain = context.createGain();

    noise.buffer = this.noiseBuffer;
    noiseHp.type = 'highpass';
    noiseHp.frequency.value = expRange(800, 6000, filter);

    noiseGain.gain.setValueAtTime(amplitude * 1.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + noiseDecay);

    noise.connect(noiseHp);
    noiseHp.connect(noiseGain);
    noiseGain.connect(output);

    noise.start(time);
    noise.stop(time + noiseDecay + 0.02);

    const toneOsc = context.createOscillator();
    const toneGain = context.createGain();
    const toneFilter = context.createBiquadFilter();

    toneOsc.type = 'triangle';
    toneOsc.frequency.setValueAtTime(185 + tone * 120, time);
    toneOsc.frequency.exponentialRampToValueAtTime(
      120 + tone * 60,
      time + toneDecay,
    );

    toneGain.gain.setValueAtTime(amplitude * 0.7, time);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, time + toneDecay);

    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = expRange(600, 4500, filter);
    toneFilter.Q.value = 0.3 + filter * 2;

    toneOsc.connect(toneGain);
    toneGain.connect(toneFilter);
    toneFilter.connect(output);

    toneOsc.start(time);
    toneOsc.stop(time + toneDecay + 0.02);
  }

  private triggerHihat(
    context: AudioContext,
    time: number,
    amplitude: number,
    design: DrumVoiceDesign,
    output: GainNode,
  ): void {
    if (!this.noiseBuffer) {
      return;
    }

    const tone = normalized(design.tone);
    const filter = normalized(design.filter);
    const decay = normalized(design.decay);

    const decayTime = 0.03 + decay * 0.2;

    const noise = context.createBufferSource();
    const noiseHp = context.createBiquadFilter();
    const noiseBp = context.createBiquadFilter();
    const noiseGain = context.createGain();

    noise.buffer = this.noiseBuffer;

    noiseHp.type = 'highpass';
    noiseHp.frequency.value = expRange(2000, 9000, filter);

    noiseBp.type = 'bandpass';
    noiseBp.frequency.value = expRange(5000, 14000, tone * 0.5 + 0.3);
    noiseBp.Q.value = 1.0 + tone * 4;

    noiseGain.gain.setValueAtTime(amplitude * 1.2, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + decayTime);

    noise.connect(noiseHp);
    noiseHp.connect(noiseBp);
    noiseBp.connect(noiseGain);
    noiseGain.connect(output);

    noise.start(time);
    noise.stop(time + decayTime + 0.02);
  }
}
