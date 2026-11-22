import {
  ArrowDownToLine,
  Maximize2,
  Move,
  Orbit,
  RotateCcw,
  RotateCw,
  Scaling,
  Sliders,
} from 'lucide-react';
import type { ModelTransform, TransformMode } from '../types/viewer';

interface TransformPanelProps {
  transformMode: TransformMode;
  transform: ModelTransform;
  dimensionsMeters?: [number, number, number];
  isXR: boolean;
  onChangeMode: (mode: TransformMode) => void;
  onChangeTransform: (next: Partial<ModelTransform>) => void;
  onScalePreset: (preset: 'fit' | '1:1' | '1:10' | '1:20' | '1:50' | '1:100') => void;
  onSnapToFloor: () => void;
  onReset: () => void;
  onFitCamera: () => void;
}

export function TransformPanel({
  transformMode,
  transform,
  dimensionsMeters,
  isXR,
  onChangeMode,
  onChangeTransform,
  onScalePreset,
  onSnapToFloor,
  onReset,
  onFitCamera,
}: TransformPanelProps) {
  const scaleLog = Math.log10(Math.max(0.01, Math.min(10, transform.scale)));

  const updatePosAxis = (axis: 0 | 1 | 2, val: number) => {
    const next: [number, number, number] = [...transform.position];
    next[axis] = Number.isFinite(val) ? val : 0;
    onChangeTransform({ position: next });
  };

  const updateRotAxis = (axis: 0 | 1 | 2, val: number) => {
    const next: [number, number, number] = [...transform.rotationDeg];
    next[axis] = Number.isFinite(val) ? val : 0;
    onChangeTransform({ rotationDeg: next });
  };

  const scaledDims = dimensionsMeters
    ? dimensionsMeters.map((d) => (d * transform.scale).toFixed(2))
    : null;

  return (
    <div className="panel-section">
      <div className="panel-header-row">
        <div className="panel-title">
          <Sliders size={15} />
          <span>Transformar Modelo</span>
        </div>
        {scaledDims && (
          <span className="pill-badge" title="Dimensiones actuales (Ancho × Alto × Fondo)">
            {scaledDims[0]}×{scaledDims[1]}×{scaledDims[2]} m
          </span>
        )}
      </div>

      {!isXR && (
        <div className="control-block">
          <div className="control-label">Gizmo 3D Interactivo</div>
          <div className="segmented-grid-4">
            <button
              type="button"
              className={`seg-btn ${transformMode === 'none' ? 'is-active' : ''}`}
              onClick={() => onChangeMode('none')}
              title="Modo cámara / órbita (Q)"
            >
              <Orbit size={14} />
              <span>Órbita</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${transformMode === 'translate' ? 'is-active' : ''}`}
              onClick={() => onChangeMode('translate')}
              title="Mover modelo (G)"
            >
              <Move size={14} />
              <span>Mover</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${transformMode === 'rotate' ? 'is-active' : ''}`}
              onClick={() => onChangeMode('rotate')}
              title="Rotar modelo (R)"
            >
              <RotateCw size={14} />
              <span>Rotar</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${transformMode === 'scale' ? 'is-active' : ''}`}
              onClick={() => onChangeMode('scale')}
              title="Escalar modelo (S)"
            >
              <Scaling size={14} />
              <span>Escalar</span>
            </button>
          </div>
        </div>
      )}

      {/* Scale */}
      <div className="control-block">
        <div className="control-label-row">
          <span className="control-label">Escala Uniforme</span>
          <span className="control-value">{(transform.scale * 100).toFixed(1)}%</span>
        </div>
        <input
          type="range"
          min={-2}
          max={1}
          step={0.01}
          value={scaleLog}
          onChange={(e) => {
            const factor = Math.pow(10, Number(e.target.value));
            onChangeTransform({ scale: Number(factor.toFixed(4)) });
          }}
          className="range-slider"
        />
        <div className="preset-grid">
          {(['fit', '1:1', '1:10', '1:20', '1:50', '1:100'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className="btn btn-xs"
              onClick={() => onScalePreset(preset)}
            >
              {preset === 'fit' ? 'Ajustar' : preset}
            </button>
          ))}
        </div>
      </div>

      {/* Rotation */}
      <div className="control-block">
        <div className="control-label-row">
          <span className="control-label">Rotación (°)</span>
          <div className="mini-actions">
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => updateRotAxis(1, transform.rotationDeg[1] - 45)}
            >
              ↺ -45°
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => updateRotAxis(1, transform.rotationDeg[1] + 45)}
            >
              ↻ +45°
            </button>
          </div>
        </div>
        {(['X', 'Y', 'Z'] as const).map((axisName, idx) => (
          <div key={axisName} className="axis-row">
            <span className={`axis-tag axis-${axisName.toLowerCase()}`}>{axisName}</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={transform.rotationDeg[idx]}
              onChange={(e) => updateRotAxis(idx as 0 | 1 | 2, Number(e.target.value))}
              className="range-slider"
            />
            <input
              type="number"
              className="num-input"
              value={transform.rotationDeg[idx]}
              onChange={(e) => updateRotAxis(idx as 0 | 1 | 2, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      {/* Position */}
      <div className="control-block">
        <div className="control-label">Posición (metros)</div>
        {(['X', 'Y', 'Z'] as const).map((axisName, idx) => (
          <div key={axisName} className="axis-row">
            <span className={`axis-tag axis-${axisName.toLowerCase()}`}>{axisName}</span>
            <input
              type="range"
              min={-15}
              max={15}
              step={0.05}
              value={Math.max(-15, Math.min(15, transform.position[idx]))}
              onChange={(e) => updatePosAxis(idx as 0 | 1 | 2, Number(e.target.value))}
              className="range-slider"
            />
            <input
              type="number"
              step={0.1}
              className="num-input"
              value={transform.position[idx]}
              onChange={(e) => updatePosAxis(idx as 0 | 1 | 2, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn-sm" onClick={onSnapToFloor}>
          <ArrowDownToLine size={13} /> Apoyar en suelo
        </button>
        {!isXR && (
          <button type="button" className="btn btn-sm" onClick={onFitCamera}>
            <Maximize2 size={13} /> Encuadrar
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onReset}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      <div className="info-tip">
        <strong>Controles WebXR:</strong> agarre con 1 mano/gatillo para mover y rotar; 2 manos para escalar y girar. Sticks: Izq. mover, Der. rotar/escalar.
      </div>
    </div>
  );
}
