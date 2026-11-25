import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import './App.css';
import { DrumSynth909, type DrumVoiceDesign } from './audio808';
import {
  loadBrowserBankState,
  resetBrowserBankState,
  saveBrowserBankState,
  type BrowserBankState,
} from './browserPersistence';
import {
  decodeGridsFirmwareWav,
  encodeGridsFirmwareWav,
  GRIDS_WAV_OUTPUT_SAMPLE_RATE,
  patchGridsNodesInFirmware,
  validateGridsFirmwareBinary,
} from './avrAudioBootloader';
import {
  FALLBACK_FACTORY_NODES,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  STEPS_PER_PATTERN,
  createPatternFromProgrammedSteps,
  fetchFactoryNodes,
  generatePatternFromFactory,
  generateTrackForInstrument,
  interpolationNodeIndicesFromXY,
  makeStepCell,
  reencodeUserStep,
  nodeDataFromPattern,
  nodeIndexFromXY,
  randomizeSequencerPattern,
  type InstrumentKey,
  type KnobState,
  type PatternState,
  type StepCell,
} from './grids';
import {
  EditorExportPanel,
  MapAndDensityPanel,
  SequencerPanel,
} from './editorPanels';
import {
  normalizeImportedJson,
  normalizePatternFromAny,
  type SoundDesignState,
} from './importExport';
import { buildFirmwarePatchSnapshot, buildLookupTablesPython } from './firmwareExport';
import { startPlaybackScheduler } from './playbackScheduler';
import {
  getBundledStockGridsFirmwareInfo,
  loadBundledStockGridsFirmwareBinary,
} from './stockFirmware';
import { downloadBinaryFile, downloadTextFile, sha256Hex } from './utils';

interface SelectedStep {
  instrument: InstrumentKey;
  step: number;
}

/**
 * Defaults are firmware-internal map/fill values (high density = more notes).
 * Center map 128/128; dense channel fills match common Grids use.
 */
const DEFAULT_KNOBS: KnobState = {
  x: 128,
  y: 128,
  chaos: 64,
  density: {
    kick: 192,
    snare: 144,
    hihat: 216,
  },
};

const DEFAULT_CHANNEL_LEVELS: Record<InstrumentKey, number> = {
  kick: 0.95,
  snare: 0.8,
  hihat: 0.72,
};

const DEFAULT_SOUND_DESIGN: SoundDesignState = {
  kick: { tone: 74, filter: 72, decay: 84 },
  snare: { tone: 66, filter: 64, decay: 68 },
  hihat: { tone: 80, filter: 88, decay: 46 },
};

function nodesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function cloneNodes(nodes: number[][]): number[][] {
  return nodes.map((node) => [...node]);
}

function savedBankStatus(state: BrowserBankState | null): string {
  if (!state) {
    return 'Browser bank: no saved edits yet (or a previous storage version was ignored after a knob-mapping update).';
  }
  const savedDate = new Date(state.savedAt);
  const savedText = Number.isNaN(savedDate.getTime())
    ? 'previous session'
    : savedDate.toLocaleString();
  return `Browser bank: restored saved edits from ${savedText}.`;
}

function App() {
  const [initialBrowserBankState] = useState<BrowserBankState | null>(() => loadBrowserBankState());
  const [knobs, setKnobs] = useState<KnobState>(() => initialBrowserBankState?.knobs ?? DEFAULT_KNOBS);
  const [factoryNodes, setFactoryNodes] = useState<number[][]>(FALLBACK_FACTORY_NODES);
  const [editableNodes, setEditableNodes] = useState<number[][]>(() =>
    cloneNodes(initialBrowserBankState?.editableNodes ?? FALLBACK_FACTORY_NODES),
  );
  const [factoryStatus, setFactoryStatus] = useState<'loading' | 'live' | 'fallback'>('loading');
  const [pattern, setPattern] = useState<PatternState>(() =>
    generatePatternFromFactory(
      initialBrowserBankState?.knobs ?? DEFAULT_KNOBS,
      initialBrowserBankState?.editableNodes ?? FALLBACK_FACTORY_NODES,
    ),
  );
  const [selected, setSelected] = useState<SelectedStep>({ instrument: 'kick', step: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadStep, setPlayheadStep] = useState(0);
  const [bpm, setBpm] = useState(124);
  const [masterVolume, setMasterVolume] = useState(0.74);
  const [channelLevels, setChannelLevels] =
    useState<Record<InstrumentKey, number>>(DEFAULT_CHANNEL_LEVELS);
  const [soundDesign, setSoundDesign] = useState<SoundDesignState>(DEFAULT_SOUND_DESIGN);
  const [importStatus, setImportStatus] = useState('No .json import yet.');
  const [browserBankStatus, setBrowserBankStatus] = useState(() =>
    savedBankStatus(initialBrowserBankState),
  );
  const [firmwareStatus, setFirmwareStatus] = useState(
    'Embedded stock firmware baseline is ready for local export.',
  );

  const synthRef = useRef(new DrumSynth909());
  const stepCursorRef = useRef(0);
  const patternRef = useRef(pattern);
  const patternDirtyRef = useRef(false);
  const knobsRef = useRef(knobs);
  const editableNodesRef = useRef(editableNodes);
  const browserBankMutatedRef = useRef(false);
  const soundDesignRef = useRef(soundDesign);
  const stockFirmwareRef = useRef<Uint8Array | null>(null);
  const playbackControllerRef = useRef<ReturnType<typeof startPlaybackScheduler> | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importPatternInputRef = useRef<HTMLInputElement | null>(null);

  const persistEditableNodes = (nodes: number[][], status = 'Browser bank: saved edits locally.') => {
    browserBankMutatedRef.current = true;
    const saved = saveBrowserBankState({ editableNodes: nodes, knobs: knobsRef.current });
    setBrowserBankStatus(
      saved
        ? status
        : 'Browser bank: storage is unavailable, so edits are saved only until this tab closes.',
    );
  };

  useEffect(() => {
    patternRef.current = pattern;
  }, [pattern]);

  const replaceVisiblePattern = (nextPattern: PatternState, dirty = false): PatternState => {
    patternRef.current = nextPattern;
    patternDirtyRef.current = dirty;
    setPattern(nextPattern);
    return nextPattern;
  };

  const updateVisiblePattern = (
    updater: (previous: PatternState) => PatternState,
    markDirty = false,
  ): PatternState => {
    const nextPattern = updater(patternRef.current);
    patternRef.current = nextPattern;
    if (markDirty) {
      patternDirtyRef.current = true;
    }
    setPattern(nextPattern);
    return nextPattern;
  };

  useEffect(() => {
    knobsRef.current = knobs;
  }, [knobs]);

  useEffect(() => {
    editableNodesRef.current = editableNodes;
  }, [editableNodes]);

  useEffect(() => {
    soundDesignRef.current = soundDesign;
  }, [soundDesign]);

  useEffect(() => {
    synthRef.current.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    synthRef.current.setChannelLevels(channelLevels);
  }, [channelLevels]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const nodes = await fetchFactoryNodes();
      if (disposed) {
        return;
      }
      const nextNodes = cloneNodes(nodes);
      setFactoryNodes(nextNodes);
      setFactoryStatus('live');
      if (initialBrowserBankState) {
        replaceVisiblePattern(generatePatternFromFactory(knobsRef.current, editableNodesRef.current));
      } else if (!browserBankMutatedRef.current) {
        setEditableNodes(nextNodes);
        editableNodesRef.current = nextNodes;
        replaceVisiblePattern(generatePatternFromFactory(knobsRef.current, nextNodes));
      }
    })();

    return () => {
      disposed = true;
    };
  }, [initialBrowserBankState]);

  useEffect(() => {
    if (!isPlaying) {
      playbackControllerRef.current?.stop();
      playbackControllerRef.current = null;
      return undefined;
    }

    playbackControllerRef.current?.stop();
    playbackControllerRef.current = startPlaybackScheduler(
      synthRef.current,
      stepCursorRef.current,
      () => ({
        bpm,
        knobs: knobsRef.current,
        pattern: patternRef.current,
        soundDesign: soundDesignRef.current,
      }),
      {
        onStep: (step) => {
          stepCursorRef.current = (step + 1) % STEPS_PER_PATTERN;
          setPlayheadStep(step);
        },
      },
    );

    return () => {
      playbackControllerRef.current?.stop();
      playbackControllerRef.current = null;
    };
  }, [bpm, isPlaying]);

  const selectedCell = pattern[selected.instrument][selected.step];

  const commitPatternToEditableNodes = (
    patternToCommit: PatternState,
    status = 'Browser bank: saved current edit locally.',
  ): number[][] => {
    const currentKnobs = knobsRef.current;
    const replacementNode = nodeDataFromPattern(patternToCommit);
    const nextNodes = cloneNodes(editableNodesRef.current);
    // Write the heard pattern into every node that contributes to the current XY morph.
    for (const nodeIndex of interpolationNodeIndicesFromXY(currentKnobs.x, currentKnobs.y)) {
      nextNodes[nodeIndex] = [...replacementNode];
    }
    editableNodesRef.current = nextNodes;
    patternDirtyRef.current = false;
    setEditableNodes(nextNodes);
    persistEditableNodes(nextNodes, status);
    return nextNodes;
  };

  const commitCurrentPatternToEditableNodes = (): number[][] => {
    if (!patternDirtyRef.current) {
      return editableNodesRef.current;
    }

    return commitPatternToEditableNodes(patternRef.current);
  };

  const regenerateFromKnobs = () => {
    const nodes = commitCurrentPatternToEditableNodes();
    replaceVisiblePattern(generatePatternFromFactory(knobs, nodes));
  };

  const mergeGeneratedPattern = (
    previous: PatternState,
    nextKnobs: KnobState,
    changedInstrument?: InstrumentKey,
    nodes: number[][] = editableNodesRef.current,
  ): PatternState => {
    const updated: PatternState = { ...previous };
    const instrumentsToUpdate = changedInstrument ? [changedInstrument] : INSTRUMENTS;
    for (const instrument of instrumentsToUpdate) {
      const generatedTrack = generateTrackForInstrument(instrument, nextKnobs, nodes);
      updated[instrument] = previous[instrument].map((cell, step) => (
        cell.generated === false ? { ...cell } : { ...generatedTrack[step] }
      ));
    }
    return updated;
  };

  const updateKnobs = (updater: (previous: KnobState) => KnobState) => {
    setKnobs((previous) => {
      const committedNodes = commitCurrentPatternToEditableNodes();
      const next = updater(previous);
      const mapPositionChanged = next.x !== previous.x || next.y !== previous.y;
      knobsRef.current = next;
      if (mapPositionChanged) {
        replaceVisiblePattern(generatePatternFromFactory(next, committedNodes));
      } else if (next.chaos !== previous.chaos) {
        // Chaos changed: re-encode per-step chance into map levels for user steps.
        let userStepsChanged = false;
        const nextPattern = (() => {
          const updated = { ...patternRef.current };
          for (const instrument of INSTRUMENTS) {
            updated[instrument] = patternRef.current[instrument].map((cell) => {
              if (cell.generated !== false) {
                return cell;
              }
              const reencoded = reencodeUserStep(cell, next.density[instrument], next.chaos);
              if (reencoded.level !== cell.level || reencoded.active !== cell.active) {
                userStepsChanged = true;
              }
              return reencoded;
            });
          }
          return updated;
        })();
        replaceVisiblePattern(nextPattern, false);
        if (userStepsChanged) {
          commitPatternToEditableNodes(nextPattern);
        }
      }
      saveBrowserBankState({ editableNodes: editableNodesRef.current, knobs: next });
      return next;
    });
  };

  const updateDensity = (instrument: InstrumentKey, value: number) => {
    setKnobs((previous) => {
      const next = {
        ...previous,
        density: {
          ...previous.density,
          [instrument]: value,
        },
      };
      knobsRef.current = next;
      // Keep user-programmed velocity/chance intent encoded for the new FILL value.
      let userStepsChanged = false;
      const nextPattern = (() => {
        const pattern = mergeGeneratedPattern(patternRef.current, next, instrument);
        const track = pattern[instrument].map((cell) => {
          if (cell.generated !== false) {
            return cell;
          }
          const reencoded = reencodeUserStep(cell, value, next.chaos);
          if (reencoded.level !== cell.level || reencoded.active !== cell.active) {
            userStepsChanged = true;
          }
          return reencoded;
        });
        return { ...pattern, [instrument]: track };
      })();
      replaceVisiblePattern(nextPattern, false);
      if (userStepsChanged) {
        commitPatternToEditableNodes(nextPattern);
      }
      saveBrowserBankState({ editableNodes: editableNodesRef.current, knobs: next });
      return next;
    });
  };

  const updateSoundDesign = (
    instrument: InstrumentKey,
    parameter: keyof DrumVoiceDesign,
    value: number,
  ) => {
    setSoundDesign((previous) => ({
      ...previous,
      [instrument]: {
        ...previous[instrument],
        [parameter]: value,
      },
    }));
  };

  const toggleStep = (
    event: MouseEvent<HTMLButtonElement>,
    instrument: InstrumentKey,
    step: number,
  ) => {
    setSelected({ instrument, step });
    if (event.shiftKey) {
      return;
    }

    const nextPattern = updateVisiblePattern((previous) => {
      const updatedTrack = [...previous[instrument]];
      const currentCell = updatedTrack[step];
      if (currentCell.active) {
        updatedTrack[step] = makeStepCell({
          active: false,
          density: knobsRef.current.density[instrument],
          generated: false,
        });
      } else {
        updatedTrack[step] = reencodeUserStep(
          currentCell,
          knobsRef.current.density[instrument],
          knobsRef.current.chaos,
          {
            active: true,
            strength: currentCell.strength ?? 'normal',
            velocity: currentCell.velocity > 0 ? currentCell.velocity : undefined,
            chaosChance: currentCell.chaosChance > 0 ? currentCell.chaosChance : 100,
          },
        );
      }
      return {
        ...previous,
        [instrument]: updatedTrack,
      };
    }, true);
    commitPatternToEditableNodes(nextPattern);
  };

  const clearSequencer = () => {
    const nextPattern = createPatternFromProgrammedSteps();
    replaceVisiblePattern(nextPattern, true);
    commitPatternToEditableNodes(nextPattern, 'Browser bank: cleared the current XY pattern.');
  };

  const randomizeSequencer = () => {
    const nextPattern = randomizeSequencerPattern(knobsRef.current);
    replaceVisiblePattern(nextPattern, true);
    commitPatternToEditableNodes(nextPattern, 'Browser bank: saved a random current XY pattern.');
  };

  const updateSelectedCell = (changes: Partial<StepCell>) => {
    const nextPattern = updateVisiblePattern((previous) => {
      const updatedTrack = [...previous[selected.instrument]];
      const currentCell = updatedTrack[selected.step];
      const nextActive = changes.active ?? currentCell.active;
      const nextStrength = changes.strength ?? currentCell.strength;
      const requestedLevel = changes.level;
      if (!nextActive) {
        updatedTrack[selected.step] = reencodeUserStep(currentCell, knobsRef.current.density[selected.instrument], knobsRef.current.chaos, { active: false });
      } else if (requestedLevel !== undefined) {
        updatedTrack[selected.step] = makeStepCell({
          active: true,
          density: knobsRef.current.density[selected.instrument],
          chaos: knobsRef.current.chaos,
          strength: nextStrength,
          level: requestedLevel,
          velocity: changes.velocity ?? currentCell.velocity,
          chaosChance: changes.chaosChance ?? currentCell.chaosChance,
          generated: false,
        });
      } else {
        updatedTrack[selected.step] = reencodeUserStep(currentCell, knobsRef.current.density[selected.instrument], knobsRef.current.chaos, {
          active: true,
          strength: nextStrength,
          velocity: changes.velocity ?? currentCell.velocity,
          chaosChance: changes.chaosChance ?? (currentCell.chaosChance > 0 ? currentCell.chaosChance : 100),
        });
      }
      return {
        ...previous,
        [selected.instrument]: updatedTrack,
      };
    }, true);
    commitPatternToEditableNodes(nextPattern);
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    await synthRef.current.resume();
    setIsPlaying(true);
  };

  const importJsonFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      const imported = normalizeImportedJson(raw, DEFAULT_SOUND_DESIGN);
      if (!imported) {
        setImportStatus('Import failed: file does not match known Grids export format.');
        return;
      }

      const appliedSections: string[] = [];
      let knobsForRegeneration = knobsRef.current;

      if (imported.knobs) {
        setKnobs(imported.knobs);
        knobsRef.current = imported.knobs;
        knobsForRegeneration = imported.knobs;
        appliedSections.push('knobs');
      }

      if (imported.bpm !== null) {
        setBpm(imported.bpm);
        appliedSections.push('BPM');
      }

      if (imported.masterVolume !== null) {
        setMasterVolume(imported.masterVolume);
        appliedSections.push('master volume');
      }

      if (imported.channelLevels) {
        setChannelLevels(imported.channelLevels);
        appliedSections.push('channel levels');
      }

      if (imported.soundDesign) {
        setSoundDesign(imported.soundDesign);
        soundDesignRef.current = imported.soundDesign;
        appliedSections.push('sound design');
      }

      if (imported.editableNodes) {
        const importedNodes = cloneNodes(imported.editableNodes);
        setEditableNodes(importedNodes);
        editableNodesRef.current = importedNodes;
        persistEditableNodes(importedNodes, 'Browser bank: saved imported editable bank locally.');
        appliedSections.push('editable node bank');
      }

      if (imported.pattern) {
        replaceVisiblePattern(imported.pattern, true);
        commitCurrentPatternToEditableNodes();
        appliedSections.push('pattern');
      } else if (imported.editableNodes) {
        replaceVisiblePattern(generatePatternFromFactory(knobsForRegeneration, imported.editableNodes));
      } else if (imported.knobs) {
        replaceVisiblePattern(generatePatternFromFactory(knobsForRegeneration, editableNodesRef.current));
      }

      if (appliedSections.length === 0) {
        setImportStatus('Import file loaded but contained no recognized editable fields.');
      } else {
        setImportStatus(`Imported ${file.name}: ${appliedSections.join(', ')}.`);
      }
    } catch {
      setImportStatus('Import failed: could not parse JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  const importPatternJsonFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      const importedPattern = normalizePatternFromAny(raw);
      if (!importedPattern) {
        setImportStatus(
          'Pattern import failed: expected a pattern object or an export JSON containing pattern data.',
        );
        return;
      }

      replaceVisiblePattern(importedPattern, true);
      commitCurrentPatternToEditableNodes();
      setImportStatus(`Imported sequencer pattern from ${file.name}.`);
    } catch {
      setImportStatus('Pattern import failed: could not parse JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  const resetBankToDefaults = () => {
    const resetNodes = cloneNodes(factoryNodes);
    editableNodesRef.current = resetNodes;
    patternDirtyRef.current = false;
    setEditableNodes(resetNodes);
    resetBrowserBankState();
    replaceVisiblePattern(generatePatternFromFactory(knobsRef.current, resetNodes));
    setBrowserBankStatus('Browser bank: reset to factory defaults. Saved edits were cleared.');
    setImportStatus('Editable bank reset to factory defaults.');
  };

  const ensureStockFirmwareBaseline = async (): Promise<Uint8Array> => {
    if (stockFirmwareRef.current) {
      return stockFirmwareRef.current;
    }

    setFirmwareStatus('Loading embedded stock firmware baseline...');
    const decoded = await loadBundledStockGridsFirmwareBinary();
    const info = getBundledStockGridsFirmwareInfo();
    const actualHash = await sha256Hex(decoded);
    if (actualHash !== info.sha256) {
      throw new Error(
        `Embedded stock firmware hash mismatch (expected ${info.sha256}, got ${actualHash}).`,
      );
    }
    const validation = validateGridsFirmwareBinary(decoded);
    if (!validation.ok) {
      throw new Error(`Stock firmware validation failed: ${validation.message}`);
    }

    stockFirmwareRef.current = decoded;
    const warningSuffix = validation.warnings.length
      ? ` Warnings: ${validation.warnings.join(' ')}`
      : '';
    setFirmwareStatus(`Stock baseline ready (${decoded.length} bytes, sha256 ${info.sha256}).${warningSuffix}`);
    return decoded;
  };

  const buildNodePatchPlan = () => {
    if (factoryNodes.length < 25) {
      throw new Error('Factory node table is incomplete; cannot build patch plan.');
    }

    const committedNodes = commitCurrentPatternToEditableNodes();
    const targetNodeIndex = nodeIndexFromXY(knobsRef.current.x, knobsRef.current.y);
    const targetNodeIndices = interpolationNodeIndicesFromXY(knobsRef.current.x, knobsRef.current.y);
    const desiredNodes = committedNodes.map((node) => [...node]);

    const nodePatches = desiredNodes
      .map((node, nodeIndex) => ({
        nodeIndex,
        replacementNode: node,
      }))
      .filter(({ nodeIndex, replacementNode }) => !nodesEqual(replacementNode, factoryNodes[nodeIndex]));

    return { targetNodeIndex, targetNodeIndices, nodePatches, desiredNodes };
  };

  const exportFirmwareJson = () => {
    const { nodePatches, desiredNodes } = buildNodePatchPlan();
    const payload = {
      format: 'grids-webapp-firmware-v4',
      audioEngine: '808',
      ...buildFirmwarePatchSnapshot({
        bpm,
        masterVolume,
        channelLevels,
        soundDesign,
        pattern: patternRef.current,
        knobs: knobsRef.current,
        editableNodes: desiredNodes,
        factoryStatus,
        patchedNodeIndices: nodePatches.map((patch) => patch.nodeIndex),
        sourceFirmwareInfo: getBundledStockGridsFirmwareInfo(),
      }),
    };

    downloadTextFile(
      `grids-pattern-${Date.now()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
  };

  const exportSourcePatchCode = () => {
    try {
      const { targetNodeIndex, targetNodeIndices, nodePatches, desiredNodes } = buildNodePatchPlan();
      const patchedIndices = nodePatches.map((patch) => patch.nodeIndex);
      const generatedAt = new Date().toISOString();
      const nodesForExport = desiredNodes.slice(0, 25).map((node) => [...node]);
      const lookupTablesPython = buildLookupTablesPython(
        nodesForExport,
        generatedAt,
        targetNodeIndex,
        patchedIndices,
      );

      downloadTextFile(
        `lookup_tables-${Date.now()}.py`,
        lookupTablesPython,
        'text/x-python;charset=utf-8',
      );
      setFirmwareStatus(
        `Exported full lookup_tables.py (${nodePatches.length} node override(s), nearest XY node ${targetNodeIndex}, interpolation nodes ${targetNodeIndices.join(', ')}). Replace eurorack/grids/resources/lookup_tables.py and rebuild firmware.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setFirmwareStatus(`Source code export failed: ${message}`);
    }
  };

  const exportAudioFirmwareWav = async () => {
    try {
      setFirmwareStatus('Preparing patched firmware from official stock baseline...');
      const stockFirmware = await ensureStockFirmwareBaseline();
      const { targetNodeIndex, targetNodeIndices, nodePatches } = buildNodePatchPlan();

      // Always locate/patch against the embedded factory table (same bytes as stock image).
      const patchResult = nodePatches.length
        ? patchGridsNodesInFirmware(stockFirmware, FALLBACK_FACTORY_NODES, nodePatches)
        : { firmware: stockFirmware, patchedOffsets: [], warnings: [] };

      const finalFirmware = patchResult.firmware;
      const validation = validateGridsFirmwareBinary(finalFirmware);
      if (!validation.ok) {
        throw new Error(`Patched firmware failed validation: ${validation.message}`);
      }
      if (finalFirmware.length !== stockFirmware.length) {
        throw new Error(
          `Patched firmware size ${finalFirmware.length} != stock ${stockFirmware.length}; refusing export.`,
        );
      }
      if (finalFirmware.length > 0x7000) {
        throw new Error('Patched firmware would overwrite the Grids bootloader region.');
      }

      const wav = encodeGridsFirmwareWav(finalFirmware);
      const roundTrip = decodeGridsFirmwareWav(wav);
      if (!bytesEqual(roundTrip, finalFirmware)) {
        throw new Error('Round-trip verification failed: encoded WAV does not decode to patched firmware bytes.');
      }

      const durationSec = (wav.length - 44) / 2 / GRIDS_WAV_OUTPUT_SAMPLE_RATE;
      const fileName = `grids-firmware-${Date.now()}.wav`;
      downloadBinaryFile(fileName, wav, 'audio/wav');

      const warnings = [...patchResult.warnings, ...validation.warnings];
      const warningSuffix = warnings.length
        ? ` Warnings: ${warnings.join(' ')}`
        : '';
      setFirmwareStatus(
        `Exported ${fileName} (${wav.length} bytes, ~${durationSec.toFixed(1)}s, official Grids WAV format). ` +
          `Patched ${nodePatches.length} node(s); nearest XY node ${targetNodeIndex}; nodes [${targetNodeIndices.join(', ')}]. ` +
          `INSTALL: enter Grids audio bootloader, play this WAV from the start at full volume into CLOCK (mono, no EQ/FX/fades), and wait for the LEDs to finish. ` +
          `After reboot: park MAP near node ${targetNodeIndex}, set FILL high enough for your levels, match Chaos if using chance.${warningSuffix}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setFirmwareStatus(`Firmware export failed: ${message}`);
    }
  };

  return (
    <main className="app-shell">
      <header className="panel device-header">
        <h1>Mutable Instruments Grids Firmware Editor</h1>
      </header>

      <section className="panel topbar-panel">
        <div className="section-title-row">
          <h2>Playback and Sound Design</h2>
          <div className="button-row">
            <button type="button" onClick={togglePlayback}>
              {isPlaying ? 'Stop' : 'Play'}
            </button>
          </div>
        </div>
        <div className="topbar-grid">
          <label>
            BPM
            <input
              type="range"
              min={20}
              max={240}
              value={bpm}
              onChange={(event) => setBpm(Number(event.target.value))}
            />
            <span>{bpm}</span>
          </label>
          <label>
            Master Volume
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(masterVolume * 100)}
              onChange={(event) => setMasterVolume(Number(event.target.value) / 100)}
            />
            <span>{Math.round(masterVolume * 100)}%</span>
          </label>
        </div>
        <div className="sound-design-grid">
          {INSTRUMENTS.map((instrument) => (
            <div className="sound-design-card" key={`${instrument}-sound`}>
              <h3>{INSTRUMENT_LABELS[instrument]} Sound</h3>
              <label>
                Level
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(channelLevels[instrument] * 100)}
                  onChange={(event) =>
                    setChannelLevels((previous) => ({
                      ...previous,
                      [instrument]: Number(event.target.value) / 100,
                    }))
                  }
                />
                <span>{Math.round(channelLevels[instrument] * 100)}%</span>
              </label>
              <label>
                Tone
                <input
                  type="range"
                  min={0}
                  max={127}
                  value={soundDesign[instrument].tone}
                  onChange={(event) =>
                    updateSoundDesign(instrument, 'tone', Number(event.target.value))
                  }
                />
                <span>{soundDesign[instrument].tone}</span>
              </label>
              <label>
                Filter
                <input
                  type="range"
                  min={0}
                  max={127}
                  value={soundDesign[instrument].filter}
                  onChange={(event) =>
                    updateSoundDesign(instrument, 'filter', Number(event.target.value))
                  }
                />
                <span>{soundDesign[instrument].filter}</span>
              </label>
              <label>
                Decay
                <input
                  type="range"
                  min={0}
                  max={127}
                  value={soundDesign[instrument].decay}
                  onChange={(event) =>
                    updateSoundDesign(instrument, 'decay', Number(event.target.value))
                  }
                />
                <span>{soundDesign[instrument].decay}</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <MapAndDensityPanel
        knobs={knobs}
        importStatus={importStatus}
        browserBankStatus={browserBankStatus}
        importInputRef={importInputRef}
        importPatternInputRef={importPatternInputRef}
        onRegenerate={regenerateFromKnobs}
        onResetBankToDefaults={resetBankToDefaults}
        onImportJsonFile={importJsonFile}
        onImportPatternJsonFile={importPatternJsonFile}
        onUpdateKnobs={updateKnobs}
        onUpdateDensity={updateDensity}
      />

      <SequencerPanel
        isPlaying={isPlaying}
        playheadStep={playheadStep}
        pattern={pattern}
        knobs={knobs}
        selected={selected}
        onToggleStep={toggleStep}
        onClear={clearSequencer}
        onRandomize={randomizeSequencer}
      />

      <EditorExportPanel
        selected={selected}
        selectedCell={selectedCell}
        knobs={knobs}
        firmwareStatus={firmwareStatus}
        onUpdateSelectedCell={updateSelectedCell}
        onExportFirmwareJson={exportFirmwareJson}
        onExportSourcePatchCode={exportSourcePatchCode}
        onExportAudioFirmwareWav={exportAudioFirmwareWav}
      />
    </main>
  );
}

export default App;
