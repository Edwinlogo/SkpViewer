import { useState } from 'react';
import {
  Camera,
  Clapperboard,
  Film,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react';
import type { AnimationPlaybackState, ViewerScene } from '../types/viewer';

interface ScenesPanelProps {
  scenes: ViewerScene[];
  clipNames: string[];
  playback: AnimationPlaybackState;
  onSelectScene: (sceneId: string) => void;
  onTogglePlay: () => void;
  onStepScene: (delta: -1 | 1) => void;
  onSetSpeed: (speed: number) => void;
  onToggleLoop: (loop: boolean) => void;
  onCaptureScene: (name: string) => void;
  onDeleteCustomScene: (sceneId: string) => void;
  onSelectClip: (clipName: string) => void;
  onSeekClip: (timeSec: number) => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toFixed(1).padStart(4, '0')}`;
}

export function ScenesPanel({
  scenes,
  clipNames,
  playback,
  onSelectScene,
  onTogglePlay,
  onStepScene,
  onSetSpeed,
  onToggleLoop,
  onCaptureScene,
  onDeleteCustomScene,
  onSelectClip,
  onSeekClip,
}: ScenesPanelProps) {
  const [newSceneName, setNewSceneName] = useState('');

  const handleCreate = () => {
    const clean = newSceneName.trim() || `Escena ${scenes.length + 1}`;
    onCaptureScene(clean);
    setNewSceneName('');
  };

  return (
    <div className="panel-section">
      <div className="panel-header-row">
        <div className="panel-title">
          <Clapperboard size={15} />
          <span>Escenas y Animación</span>
        </div>
        <span className="pill-badge">{scenes.length}</span>
      </div>

      {/* Main Transport Bar */}
      <div className="transport-card">
        <div className="transport-controls">
          <button
            type="button"
            className="icon-btn-lg"
            onClick={() => onStepScene(-1)}
            disabled={scenes.length === 0}
            title="Escena anterior"
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className={`btn btn-primary transport-play-btn ${playback.isPlaying ? 'is-playing' : ''}`}
            onClick={onTogglePlay}
            disabled={scenes.length === 0 && clipNames.length === 0}
          >
            {playback.isPlaying ? <Pause size={16} /> : <Play size={16} />}
            <span>{playback.isPlaying ? 'Pausar' : 'Reproducir'}</span>
          </button>
          <button
            type="button"
            className="icon-btn-lg"
            onClick={() => onStepScene(1)}
            disabled={scenes.length === 0}
            title="Siguiente escena"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="transport-meta-row">
          <button
            type="button"
            className={`btn btn-xs ${playback.sceneLoop ? 'is-active' : ''}`}
            onClick={() => onToggleLoop(!playback.sceneLoop)}
            title="Repetir bucle de escenas"
          >
            <Repeat size={12} /> Bucle
          </button>
          <div className="speed-pills">
            {[0.5, 1, 1.5, 2].map((sp) => (
              <button
                key={sp}
                type="button"
                className={`speed-pill ${Math.abs(playback.speed - sp) < 0.05 ? 'is-active' : ''}`}
                onClick={() => onSetSpeed(sp)}
              >
                {sp}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Embedded glTF / Collada Animation Clip timeline */}
      {clipNames.length > 0 && (
        <div className="control-block">
          <div className="control-label-row">
            <span className="control-label">
              <Film size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Clips de Animación 3D
            </span>
            <span className="control-value">
              {formatTime(playback.clipTime)} / {formatTime(playback.clipDuration)}
            </span>
          </div>
          {clipNames.length > 1 && (
            <select
              className="select-input"
              value={playback.activeClipName ?? clipNames[0]}
              onChange={(e) => onSelectClip(e.target.value)}
            >
              {clipNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <input
            type="range"
            min={0}
            max={Math.max(0.01, playback.clipDuration)}
            step={0.02}
            value={Math.min(playback.clipTime, playback.clipDuration)}
            onChange={(e) => onSeekClip(Number(e.target.value))}
            className="range-slider"
          />
        </div>
      )}

      {/* Capture custom scene */}
      <div className="capture-row">
        <input
          type="text"
          className="text-input"
          value={newSceneName}
          onChange={(e) => setNewSceneName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Nombre de nueva escena…"
        />
        <button
          type="button"
          className="btn btn-sm btn-accent"
          onClick={handleCreate}
          title="Guarda la cámara actual y visibilidad de capas/elementos como una escena animada"
        >
          <Plus size={14} /> Capturar
        </button>
      </div>

      {/* Scenes list */}
      <div className="scroll-list">
        {scenes.length === 0 ? (
          <div className="empty-hint">
            Este archivo no incluye escenas guardadas. Captura vistas con el botón superior para crear tu propio recorrido animado (se guardan offline).
          </div>
        ) : (
          scenes.map((sc, idx) => {
            const isActive = playback.activeSceneId === sc.id;
            const hiddenLayerCount = sc.hiddenLayerIds?.length ?? 0;
            const hiddenNodeCount = sc.hiddenNodeIds?.length ?? 0;
            return (
              <div key={sc.id} className={`scene-card ${isActive ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="scene-card-main"
                  onClick={() => onSelectScene(sc.id)}
                >
                  <div className="scene-index">{idx + 1}</div>
                  <div className="scene-info">
                    <div className="scene-name">{sc.name}</div>
                    <div className="scene-meta">
                      {sc.source === 'skp-page' && (
                        <span>
                          <Camera size={11} /> SketchUp
                        </span>
                      )}
                      {sc.source === 'gltf-animation' && (
                        <span>
                          <Film size={11} /> Clip 3D
                        </span>
                      )}
                      {sc.source === 'custom' && <span>Personalizada</span>}
                      {hiddenLayerCount > 0 && <span>· {hiddenLayerCount} capas ocultas</span>}
                      {hiddenNodeCount > 0 && <span>· {hiddenNodeCount} elem. ocultos</span>}
                    </div>
                  </div>
                </button>
                {sc.source === 'custom' && (
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    title="Eliminar escena personalizada"
                    onClick={() => onDeleteCustomScene(sc.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
