import { useRef } from 'react';
import {
  Box,
  Database,
  FileUp,
  HardDrive,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ModelStats, SavedModelMeta } from '../types/viewer';
import { formatBytes } from '../storage/modelStore';

interface LibraryPanelProps {
  currentModelId: string | null;
  currentModelName: string | null;
  currentStats: ModelStats | null;
  savedModels: SavedModelMeta[];
  onUploadFile: (file: File) => void;
  onLoadDemo: () => void;
  onLoadSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
}

export function LibraryPanel({
  currentModelId,
  currentModelName,
  currentStats,
  savedModels,
  onUploadFile,
  onLoadDemo,
  onLoadSaved,
  onDeleteSaved,
}: LibraryPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="panel-section">
      <div className="panel-header-row">
        <div className="panel-title">
          <HardDrive size={15} />
          <span>Archivos y Biblioteca Offline</span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".skp,.glb,.gltf,.dae,.kmz,.obj"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadFile(f);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        className="upload-drop-btn"
        onClick={() => inputRef.current?.click()}
      >
        <FileUp size={20} />
        <div>
          <strong>Abrir archivo SketchUp o 3D</strong>
          <span>.SKP nativo (2013–2025+) · .GLB · .GLTF · .DAE · .KMZ · .OBJ</span>
        </div>
      </button>

      <button type="button" className="btn btn-accent demo-btn" onClick={onLoadDemo}>
        <Sparkles size={15} />
        <span>Cargar Pabellón Arquitectónico Demo (.SKP)</span>
      </button>

      {currentStats && currentModelName && (
        <div className="stats-card">
          <div className="stats-title">Modelo Activo: {currentModelName}</div>
          <div className="stats-grid">
            <div>
              <span>Triángulos</span>
              <strong>{currentStats.triangles.toLocaleString()}</strong>
            </div>
            <div>
              <span>Mallas</span>
              <strong>{currentStats.meshes.toLocaleString()}</strong>
            </div>
            <div>
              <span>Capas</span>
              <strong>{currentStats.layers}</strong>
            </div>
            <div>
              <span>Escenas</span>
              <strong>{currentStats.scenes}</strong>
            </div>
            <div>
              <span>Dimensiones</span>
              <strong>
                {currentStats.dimensionsMeters[0]}×{currentStats.dimensionsMeters[1]}×
                {currentStats.dimensionsMeters[2]} m
              </strong>
            </div>
            {currentStats.sketchupVersion && (
              <div>
                <span>SketchUp</span>
                <strong>v{currentStats.sketchupVersion}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="control-label-row" style={{ marginTop: 6 }}>
        <span className="control-label">
          <Database size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Guardados localmente (Offline)
        </span>
        <span className="pill-badge">{savedModels.length}</span>
      </div>

      <div className="scroll-list">
        {savedModels.length === 0 ? (
          <div className="empty-hint">
            Los modelos que abras se guardan automáticamente en tu dispositivo (IndexedDB) para abrirlos incluso sin internet.
          </div>
        ) : (
          savedModels.map((item) => {
            const isCurrent = currentModelId === item.id;
            return (
              <div key={item.id} className={`saved-item ${isCurrent ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="saved-item-main"
                  onClick={() => onLoadSaved(item.id)}
                >
                  {item.thumbnailDataUrl ? (
                    <img
                      src={item.thumbnailDataUrl}
                      alt={item.name}
                      className="saved-thumb"
                    />
                  ) : (
                    <div className="saved-thumb-placeholder">
                      <Box size={16} />
                    </div>
                  )}
                  <div className="saved-info">
                    <span className="saved-name">{item.name}</span>
                    <span className="saved-meta">
                      .{item.format.toUpperCase()} · {formatBytes(item.size)}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  title="Eliminar de memoria offline"
                  onClick={() => onDeleteSaved(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
