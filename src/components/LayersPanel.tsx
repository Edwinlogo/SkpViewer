import { useMemo, useState } from 'react';
import { Eye, EyeOff, Focus, Layers, Search } from 'lucide-react';
import type { LayerInfo } from '../types/viewer';

interface LayersPanelProps {
  layers: LayerInfo[];
  onToggleLayer: (layerId: string, visible: boolean) => void;
  onIsolateLayer: (layerId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

export function LayersPanel({
  layers,
  onToggleLayer,
  onIsolateLayer,
  onShowAll,
  onHideAll,
}: LayersPanelProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return layers;
    return layers.filter((l) => l.name.toLowerCase().includes(q));
  }, [layers, query]);

  const visibleCount = layers.filter((l) => l.visible).length;

  return (
    <div className="panel-section">
      <div className="panel-header-row">
        <div className="panel-title">
          <Layers size={15} />
          <span>Capas / Etiquetas</span>
        </div>
        <span className="pill-badge">
          {visibleCount}/{layers.length}
        </span>
      </div>

      <div className="search-input-wrap">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar capa o etiqueta…"
          className="text-input"
        />
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn-sm" onClick={onShowAll}>
          <Eye size={13} /> Mostrar todas
        </button>
        <button type="button" className="btn btn-sm" onClick={onHideAll}>
          <EyeOff size={13} /> Ocultar todas
        </button>
      </div>

      <div className="scroll-list">
        {filtered.length === 0 ? (
          <div className="empty-hint">No hay capas que coincidan con la búsqueda.</div>
        ) : (
          filtered.map((layer) => (
            <div
              key={layer.id}
              className={`list-item ${layer.visible ? '' : 'is-dimmed'}`}
            >
              <button
                type="button"
                className="list-item-main"
                onClick={() => onToggleLayer(layer.id, !layer.visible)}
                title={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
              >
                <span
                  className="color-dot"
                  style={{ backgroundColor: layer.color }}
                />
                <span className="list-item-text">
                  <span className="list-item-name">{layer.name}</span>
                  <span className="list-item-sub">
                    {layer.entityCount} {layer.entityCount === 1 ? 'elemento' : 'elementos'}
                  </span>
                </span>
              </button>

              <div className="list-item-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Aislar solo esta capa"
                  onClick={() => onIsolateLayer(layer.id)}
                >
                  <Focus size={14} />
                </button>
                <button
                  type="button"
                  className={`icon-btn ${layer.visible ? 'is-on' : ''}`}
                  title={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
                  onClick={() => onToggleLayer(layer.id, !layer.visible)}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
