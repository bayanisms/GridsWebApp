import type { ChangeEvent, CSSProperties, MouseEvent, RefObject } from 'react';
import { KnobControl, XYMap } from './components';
import {
  DRUM_MAP_LAYOUT,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  canProgramVelocity,
  chaosRandomness,
  classifyStepTrigger,
  densityThreshold,
  internalControlToPhysical,
  maxPartPerturbation,
  STEP_STRENGTH_VELOCITY,
  type InstrumentKey,
  type KnobState,
  type PatternState,
  type StepCell,
  type StepStrength,
} from './grids';

// Map dots sit on firmware-internal XY coordinates (high = denser map corner as on module).
const MAP_GRID_VALUES = [0, 64, 128, 192, 255];

const MAP_POINTS = MAP_GRID_VALUES.flatMap((gridY, yIndex) =>
  MAP_GRID_VALUES.map((gridX, xIndex) => ({
    x: gridX,
    y: gridY,
    nodeId: DRUM_MAP_LAYOUT[xIndex][yIndex],
  })),
);

interface MapAndDensityPanelProps {
  knobs: KnobState;
  importStatus: string;
  browserBankStatus: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  importPatternInputRef: RefObject<HTMLInputElement | null>;
  onRegenerate: () => void;
  onResetBankToDefaults: () => void;
  onImportJsonFile: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onImportPatternJsonFile: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onUpdateKnobs: (updater: (previous: KnobState) => KnobState) => void;
  onUpdateDensity: (instrument: InstrumentKey, value: number) => void;
}

function densityReadout(density: number): string {
  const threshold = densityThreshold(density);
  const panel = internalControlToPhysical(density);
  return `fill ${density} · thr ${threshold} · panel ADC ~${panel}`;
}

function chaosReadout(chaos: number): string {
  const randomness = chaosRandomness(chaos);
  const maxBoost = maxPartPerturbation(chaos);
  const panel = internalControlToPhysical(chaos);
  return `chaos ${chaos} · bar boost 0–${maxBoost} (R>>2=${randomness}) · panel ~${panel}`;
}

function xyReadout(value: number): string {
  return `map ${value} · panel ADC ~${internalControlToPhysical(value)}`;
}

export function MapAndDensityPanel({
  knobs,
  importStatus,
  browserBankStatus,
  importInputRef,
  importPatternInputRef,
  onRegenerate,
  onResetBankToDefaults,
  onImportJsonFile,
  onImportPatternJsonFile,
  onUpdateKnobs,
  onUpdateDensity,
}: MapAndDensityPanelProps) {
  return (
    <section className="panel map-panel">
      <div className="section-title-row">
        <h2>Map and Density Knobs</h2>
        <div className="button-row">
          <button type="button" onClick={onRegenerate}>
            Regenerate
          </button>
          <button type="button" onClick={onResetBankToDefaults}>
            Reset bank to defaults
          </button>
          <button type="button" onClick={() => importInputRef.current?.click()}>
            Import Full .json
          </button>
          <button type="button" onClick={() => importPatternInputRef.current?.click()}>
            Import Pattern .json
          </button>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="import-input"
        onChange={onImportJsonFile}
      />
      <input
        ref={importPatternInputRef}
        type="file"
        accept="application/json,.json"
        className="import-input"
        onChange={onImportPatternJsonFile}
      />
      <p className="import-status">{importStatus}</p>
      <p className="import-status">{browserBankStatus}</p>

      <div className="xy-section">
        <h3>XY Pattern Map</h3>
        <p className="muted">
          X/Y are firmware map coordinates (same as settings after ~adc). Density 0 = no notes,
          255 = densest. Chaos 0 = none, 255 = max hardware bar-hold randomness.
        </p>
        <XYMap
          x={knobs.x}
          y={knobs.y}
          mapPoints={MAP_POINTS}
          onChange={(nextX: number, nextY: number) =>
            onUpdateKnobs((previous) => ({
              ...previous,
              x: nextX,
              y: nextY,
            }))
          }
        />
      </div>

      <div className="knob-grid">
        <KnobControl
          label="X"
          min={0}
          max={255}
          value={knobs.x}
          hint={xyReadout(knobs.x)}
          onChange={(value: number) => onUpdateKnobs((previous) => ({ ...previous, x: value }))}
        />
        <KnobControl
          label="Y"
          min={0}
          max={255}
          value={knobs.y}
          hint={xyReadout(knobs.y)}
          onChange={(value: number) => onUpdateKnobs((previous) => ({ ...previous, y: value }))}
        />
        <KnobControl
          label="Chaos"
          min={0}
          max={255}
          value={knobs.chaos}
          hint={chaosReadout(knobs.chaos)}
          onChange={(value: number) => onUpdateKnobs((previous) => ({ ...previous, chaos: value }))}
        />
        <KnobControl
          label="Kick Density"
          min={0}
          max={255}
          value={knobs.density.kick}
          variant="density"
          accent="orange"
          hint={densityReadout(knobs.density.kick)}
          onChange={(value: number) => onUpdateDensity('kick', value)}
        />
        <KnobControl
          label="Snare Density"
          min={0}
          max={255}
          value={knobs.density.snare}
          variant="density"
          accent="green"
          hint={densityReadout(knobs.density.snare)}
          onChange={(value: number) => onUpdateDensity('snare', value)}
        />
        <KnobControl
          label="Hi-hat Density"
          min={0}
          max={255}
          value={knobs.density.hihat}
          variant="density"
          accent="yellow"
          hint={densityReadout(knobs.density.hihat)}
          onChange={(value: number) => onUpdateDensity('hihat', value)}
        />
      </div>
      <p className="muted">
        Density matches hardware fill: higher = lower threshold = more notes. Chaos re-rolls one
        random level boost per instrument at each bar start and holds it for 32 steps (amber steps
        only fire when that boost is large enough).
      </p>
    </section>
  );
}

interface SequencerPanelProps {
  isPlaying: boolean;
  playheadStep: number;
  pattern: PatternState;
  knobs: KnobState;
  selected: { instrument: InstrumentKey; step: number };
  onToggleStep: (event: MouseEvent<HTMLButtonElement>, instrument: InstrumentKey, step: number) => void;
  onClear: () => void;
  onRandomize: () => void;
}

export function SequencerPanel({
  isPlaying,
  playheadStep,
  pattern,
  knobs,
  selected,
  onToggleStep,
  onClear,
  onRandomize,
}: SequencerPanelProps) {
  const playheadGuideStyle = {
    '--playhead-position': `calc(${(playheadStep / 32) * 100}% + ${playheadStep * 0.09375}px)`,
  } as CSSProperties;

  return (
    <section className="panel sequencer-panel">
      <div className="section-title-row">
        <h2>XOX Sequencer (32 Steps)</h2>
        <div className="button-row">
          <button type="button" onClick={onClear}>Clear</button>
          <button type="button" onClick={onRandomize}>Randomize</button>
        </div>
      </div>
      <p className="muted">
        Solid = stable on hardware (fires at Chaos 0). Amber dashed = chaos-sensitive (needs this
        bar&apos;s random boost). Faint hatch = programmed but silent at current Density/Chaos.
        Edits commit into every XY node contributing to the current morph.
      </p>
      {INSTRUMENTS.map((instrument) => (
        <div className={`track-row track-${instrument}`} key={instrument}>
          <div className="track-label">{INSTRUMENT_LABELS[instrument]}</div>
          <div className="step-grid">
            {isPlaying ? (
              <span
                aria-hidden="true"
                className={`playhead-guide${playheadStep === 0 ? ' rewound' : ''}`}
                style={playheadGuideStyle}
              />
            ) : null}
            {pattern[instrument].map((cell, step) => {
              const isSelected = selected.instrument === instrument && selected.step === step;
              const isPlayingStep = isPlaying && playheadStep === step;
              const triggerClass = classifyStepTrigger(cell, knobs.density[instrument], knobs.chaos);
              const stable = triggerClass === 'stable';
              const chaosSensitive = triggerClass === 'chaos-sensitive';
              const ghost = triggerClass === 'ghost';
              const accent = stable && cell.strength === 'accent';
              const classNames = [
                'step-button',
                cell.active ? 'programmed' : 'inactive',
                stable ? 'active' : '',
                chaosSensitive ? 'chaos-sensitive' : '',
                ghost ? 'ghost' : '',
                accent ? 'accent' : '',
                cell.generated === false ? 'user-programmed' : '',
                isSelected ? 'selected' : '',
                isPlayingStep ? 'playhead' : '',
                step % 4 === 0 ? 'bar-start' : '',
              ]
                .filter(Boolean)
                .join(' ');

              const title = `${INSTRUMENT_LABELS[instrument]} step ${step + 1} · ${triggerClass}${
                cell.active ? ` · level ${cell.level}` : ''
              }`;

              return (
                <button
                  key={`${instrument}-${step}`}
                  type="button"
                  className={classNames}
                  aria-current={isPlayingStep ? 'step' : undefined}
                  onClick={(event) => onToggleStep(event, instrument, step)}
                  title={title}
                >
                  <span
                    className="velocity-visual"
                    style={{
                      height: `${Math.max(8, (cell.level / 255) * 100)}%`,
                      opacity: cell.active || chaosSensitive ? (stable ? 1 : chaosSensitive ? 0.7 : 0.35) : 0.12,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

interface EditorExportPanelProps {
  selected: { instrument: InstrumentKey; step: number };
  selectedCell: StepCell;
  knobs: KnobState;
  firmwareStatus: string;
  onUpdateSelectedCell: (changes: Partial<StepCell>) => void;
  onExportFirmwareJson: () => void;
  onExportSourcePatchCode: () => void;
  onExportAudioFirmwareWav: () => void | Promise<void>;
}

export function EditorExportPanel({
  selected,
  selectedCell,
  knobs,
  firmwareStatus,
  onUpdateSelectedCell,
  onExportFirmwareJson,
  onExportSourcePatchCode,
  onExportAudioFirmwareWav,
}: EditorExportPanelProps) {
  const velocityEditable = selectedCell.active && canProgramVelocity(selectedCell.chaosChance);
  const partialChanceNeedsChaos = selectedCell.active
    && selectedCell.chaosChance < 100
    && chaosRandomness(knobs.chaos) === 0;

  const updateStrength = (strength: StepStrength) => {
    onUpdateSelectedCell({
      active: true,
      strength,
      velocity: Math.round(STEP_STRENGTH_VELOCITY[strength] * 127),
      chaosChance: 100,
      generated: false,
    });
  };

  return (
    <section className="panel editor-grid editor-panel">
      <div>
        <h2>Step Programmer</h2>
        <p>
          {INSTRUMENT_LABELS[selected.instrument]} step {selected.step + 1}
        </p>
        <label className="inline-toggle">
          <input
            type="checkbox"
            checked={selectedCell.active}
            onChange={(event) =>
              onUpdateSelectedCell({
                active: event.target.checked,
                chaosChance: event.target.checked ? 100 : 0,
                generated: false,
              })
            }
          />
          Step programmed
        </label>
        <div className="strength-buttons" role="group" aria-label="Step strength">
          {(['soft', 'normal', 'accent'] as const).map((strength) => (
            <button
              key={strength}
              type="button"
              className={selectedCell.active && selectedCell.strength === strength ? 'selected' : ''}
              onClick={() => updateStrength(strength)}
            >
              {strength[0].toUpperCase() + strength.slice(1)}
            </button>
          ))}
        </div>
        <label>
          Velocity / accent (100% Chance only)
          <input
            type="range"
            min={1}
            max={127}
            value={Math.max(1, selectedCell.velocity)}
            disabled={!velocityEditable}
            onChange={(event) =>
              onUpdateSelectedCell({
                active: true,
                velocity: Number(event.target.value),
                generated: false,
              })
            }
          />
          <span>{selectedCell.velocity}</span>
        </label>
        <label>
          Chance (hardware Chaos, held for the whole bar)
          <input
            type="range"
            min={1}
            max={100}
            value={Math.max(1, selectedCell.chaosChance)}
            disabled={!selectedCell.active}
            onChange={(event) =>
              onUpdateSelectedCell({
                active: true,
                chaosChance: Number(event.target.value),
                generated: false,
              })
            }
          />
          <span>{selectedCell.chaosChance}%</span>
        </label>
        {partialChanceNeedsChaos ? (
          <p className="muted">
            This partial-Chance step is intentionally silent while Chaos is 0. Raise Chaos to make its
            probability active; it will not silently turn into a guaranteed hit.
          </p>
        ) : null}
      </div>

      <div>
        <h2>Firmware Export</h2>
        <p className="muted">
          Audio Firmware uses Mutable&apos;s verified Grids bootloader WAV format. It preserves the shipping
          file&apos;s sample timing, packet framing, page gaps, and end marker; only changes to the 25-node
          factory bank are written.
        </p>

        <div className="button-row export-row">
          <button type="button" onClick={onExportFirmwareJson}>
            Export .json
          </button>
          <button type="button" onClick={onExportSourcePatchCode}>
            Export Full lookup_tables.py
          </button>
          <button type="button" onClick={onExportAudioFirmwareWav}>
            Export Firmware .wav (audio / CLOCK)
          </button>
        </div>

        <p className="firmware-status">{firmwareStatus}</p>
        <p className="muted">
          Audio path: mono cable → CLOCK jack, full volume, play from the start, no EQ/FX or fades.
          Enter bootloader by holding TAP/reset while powering the module, start playback only after its
          confirmation flashes, and let the player reach the end of the file.
        </p>
      </div>
    </section>
  );
}
