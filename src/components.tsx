import { useRef, type PointerEvent, type WheelEvent } from 'react';
import { clampNumber, internalControlToPhysical, nodeIndexFromXY } from './grids';

interface KnobControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  variant?: 'default' | 'density';
  accent?: 'orange' | 'green' | 'yellow';
  hint?: string;
  onChange: (value: number) => void;
}

interface XYMapProps {
  x: number;
  y: number;
  mapPoints: Array<{ x: number; y: number; nodeId: number }>;
  onChange: (x: number, y: number) => void;
}

export function KnobControl({
  label,
  value,
  min,
  max,
  variant = 'default',
  accent,
  hint,
  onChange,
}: KnobControlProps) {
  const ratio = (value - min) / (max - min);
  const markerRotation = -135 + ratio * 270;
  const dragRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);
  const sensitivity = (max - min) / 180;

  const applyValue = (next: number) => {
    onChange(clampNumber(Math.round(next), min, max));
  };

  const onKnobPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startValue: value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onKnobPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const delta = drag.startY - event.clientY;
    applyValue(drag.startValue + delta * sensitivity);
  };

  const onKnobPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (
      dragRef.current &&
      dragRef.current.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const onKnobWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const wheelStep = Math.max(1, Math.round((max - min) / 64));
    applyValue(value + (event.deltaY < 0 ? wheelStep : -wheelStep));
  };

  return (
    <label className={`knob-card ${variant === 'density' ? 'knob-density' : ''} ${accent ? `knob-${accent}` : ''}`}>
      <span className="knob-label">{label}</span>
      <div
        className="knob-visual"
        onPointerDown={onKnobPointerDown}
        onPointerMove={onKnobPointerMove}
        onPointerUp={onKnobPointerUp}
        onPointerCancel={onKnobPointerUp}
        onWheel={onKnobWheel}
      >
        <div className="knob-marker" style={{ transform: `rotate(${markerRotation}deg)` }}>
          <span />
        </div>
      </div>
      <input
        className="knob-slider"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="knob-value">{value}</span>
      {hint ? <span className="knob-hint">{hint}</span> : null}
    </label>
  );
}

export function XYMap({ x, y, mapPoints, onChange }: XYMapProps) {
  const draggingRef = useRef(false);

  const updateFromPointer = (clientX: number, clientY: number, element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    const ratioX = clampNumber((clientX - bounds.left) / bounds.width, 0, 1);
    const ratioY = clampNumber((clientY - bounds.top) / bounds.height, 0, 1);
    onChange(Math.round(ratioX * 255), Math.round(ratioY * 255));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX, event.clientY, event.currentTarget);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    updateFromPointer(event.clientX, event.clientY, event.currentTarget);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const activeNode = nodeIndexFromXY(x, y);

  return (
    <div className="xy-map-wrapper">
      <div
        className="xy-map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {mapPoints.map((point) => (
          <span
            key={`node-${point.nodeId}-${point.x}-${point.y}`}
            className={`xy-node ${point.nodeId === activeNode ? 'active' : ''}`}
            style={{
              left: `${(point.x / 255) * 100}%`,
              top: `${(point.y / 255) * 100}%`,
            }}
            title={`Node ${point.nodeId} @ map (${point.x}, ${point.y})`}
          />
        ))}
        <div className="xy-crosshair horizontal" style={{ top: `${(y / 255) * 100}%` }} />
        <div className="xy-crosshair vertical" style={{ left: `${(x / 255) * 100}%` }} />
        <div
          className="xy-marker"
          style={{
            left: `${(x / 255) * 100}%`,
            top: `${(y / 255) * 100}%`,
          }}
        />
      </div>
      <p className="xy-caption">
        Map X/Y: {x}/{y} · panel ADC ~{internalControlToPhysical(x)}/~{internalControlToPhysical(y)} · nearest node: {activeNode}
      </p>
    </div>
  );
}
