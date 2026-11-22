import { useMemo, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Component,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  FolderTree,
  Search,
} from 'lucide-react';
import type { SceneNodeInfo } from '../types/viewer';

interface ElementsTreePanelProps {
  tree: SceneNodeInfo | null;
  nodeVisibility: Record<string, boolean>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onToggleNode: (nodeId: string, visible: boolean) => void;
  onIsolateNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onShowAllNodes: () => void;
}

function filterTree(node: SceneNodeInfo, q: string): SceneNodeInfo | null {
  if (!q) return node;
  const selfMatch =
    node.name.toLowerCase().includes(q) ||
    (node.definitionName?.toLowerCase().includes(q) ?? false) ||
    node.layerId.toLowerCase().includes(q);
  const matchingChildren = node.children
    .map((c) => filterTree(c, q))
    .filter((c): c is SceneNodeInfo => c !== null);

  if (selfMatch || matchingChildren.length > 0) {
    return {
      ...node,
      children: selfMatch ? node.children : matchingChildren,
    };
  }
  return null;
}

function findNodeById(node: SceneNodeInfo | null, id: string | null): SceneNodeInfo | null {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findNodeById(child, id);
    if (hit) return hit;
  }
  return null;
}

export function ElementsTreePanel({
  tree,
  nodeVisibility,
  selectedNodeId,
  onSelectNode,
  onToggleNode,
  onIsolateNode,
  onFocusNode,
  onShowAllNodes,
}: ElementsTreePanelProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'node-root': true });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTree = useMemo(
    () => (tree ? filterTree(tree, normalizedQuery) : null),
    [tree, normalizedQuery],
  );

  const selectedNode = useMemo(
    () => findNodeById(tree, selectedNodeId),
    [tree, selectedNodeId],
  );

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (node: SceneNodeInfo, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = normalizedQuery.length > 0 || (expanded[node.id] ?? depth < 1);
    const isVisible = nodeVisibility[node.id] ?? node.visible;
    const isSelected = selectedNodeId === node.id;

    return (
      <div key={node.id}>
        <div
          className={`tree-row ${isSelected ? 'is-selected' : ''} ${isVisible ? '' : 'is-dimmed'}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <button
            type="button"
            className="tree-chevron"
            onClick={() => hasChildren && toggleExpand(node.id)}
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
            aria-label="Expandir grupo"
          >
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          <button
            type="button"
            className="tree-label"
            onClick={() => onSelectNode(isSelected ? null : node.id)}
            title={`${node.name} (${node.layerId})`}
          >
            {node.type === 'component' ? (
              <Component size={13} className="tree-type-icon is-comp" />
            ) : (
              <Box size={13} className="tree-type-icon" />
            )}
            <span className="tree-name">{node.name}</span>
            {node.triangleCount > 0 && (
              <span className="tree-meta">{node.triangleCount.toLocaleString()} Δ</span>
            )}
          </button>

          <div className="list-item-actions">
            {node.id !== 'node-root' && (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  title="Enfocar cámara en este elemento"
                  onClick={() => {
                    onSelectNode(node.id);
                    onFocusNode(node.id);
                  }}
                >
                  <Crosshair size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Aislar este elemento"
                  onClick={() => onIsolateNode(node.id)}
                >
                  <Focus size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              className={`icon-btn ${isVisible ? 'is-on' : ''}`}
              title={isVisible ? 'Ocultar elemento' : 'Mostrar elemento'}
              onClick={() => onToggleNode(node.id, !isVisible)}
            >
              {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="panel-section">
      <div className="panel-header-row">
        <div className="panel-title">
          <FolderTree size={15} />
          <span>Esquema de Elementos</span>
        </div>
        <button type="button" className="btn btn-xs" onClick={onShowAllNodes}>
          Mostrar todos
        </button>
      </div>

      <div className="search-input-wrap">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar componente, grupo o malla…"
          className="text-input"
        />
      </div>

      <div className="scroll-list tree-container">
        {!filteredTree ? (
          <div className="empty-hint">Sin elementos coincidentes.</div>
        ) : (
          renderNode(filteredTree, 0)
        )}
      </div>

      {selectedNode && (
        <div className="inspector-card">
          <div className="inspector-card-title">{selectedNode.name}</div>
          <div className="inspector-grid">
            <span>Capa:</span>
            <strong>{selectedNode.layerId === 'Layer0' ? 'Sin etiqueta' : selectedNode.layerId}</strong>
            {selectedNode.definitionName && (
              <>
                <span>Definición:</span>
                <strong>{selectedNode.definitionName}</strong>
              </>
            )}
            <span>Geometría:</span>
            <strong>
              {selectedNode.meshCount} mallas · {selectedNode.triangleCount.toLocaleString()} Δ
            </strong>
          </div>
          {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
            <div className="inspector-props">
              <div className="inspector-props-label">Atributos SketchUp / BIM</div>
              {Object.entries(selectedNode.properties)
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k} className="inspector-prop-row">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
