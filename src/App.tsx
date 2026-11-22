import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Camera,
  CheckCircle2,
  Clapperboard,
  Crosshair,
  Download,
  Eye,
  FileUp,
  FolderTree,
  Glasses,
  HardDrive,
  Layers,
  Moon,
  Move,
  Orbit,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Scan,
  Scaling,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Sun,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { SceneManager } from './engine/SceneManager';
import { loadModelFromBuffer, detectModelFormat } from './loaders/universalLoader';
import {
  deleteSavedModel,
  getSavedModel,
  listSavedModels,
  loadCustomScenes,
  saveCustomScenes,
  saveModelOffline,
} from './storage/modelStore';
import { usePWA } from './hooks/usePWA';
import { useCameraPassthrough } from './hooks/useCameraPassthrough';
import { LayersPanel } from './components/LayersPanel';
import { ElementsTreePanel } from './components/ElementsTreePanel';
import { TransformPanel } from './components/TransformPanel';
import { ScenesPanel } from './components/ScenesPanel';
import { LibraryPanel } from './components/LibraryPanel';
import type {
  AnimationPlaybackState,
  BackgroundMode,
  LayerInfo,
  LoadedModel,
  ModelTransform,
  SavedModelMeta,
  TransformMode,
  ViewerScene,
  XRStatus,
} from './types/viewer';

type SidebarTab = 'layers' | 'elements' | 'transform' | 'scenes' | 'files';

const DEMO_MODEL_ID = 'builtin-pabellon-demo-skp';

export default function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const xrOverlayRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loadedModel, setLoadedModel] = useState<LoadedModel | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [nodeVisibility, setNodeVisibility] = useState<Record<string, boolean>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<ViewerScene[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelMeta[]>([]);

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('studio');
  const [transformMode, setTransformMode] = useState<TransformMode>('none');
  const [transform, setTransform] = useState<ModelTransform>({
    position: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    scale: 1,
  });
  const [showEdges, setShowEdges] = useState(true);
  const [xrayMode, setXrayMode] = useState(false);

  const [xrStatus, setXRStatus] = useState<XRStatus>({
    webXRAvailable: false,
    arSupported: false,
    vrSupported: false,
    activeMode: 'none',
    domOverlayActive: false,
    handTrackingActive: false,
    hitTestAvailable: false,
    placementActive: false,
  });

  const [playback, setPlayback] = useState<AnimationPlaybackState>({
    isPlaying: false,
    activeSceneId: null,
    activeClipName: null,
    clipTime: 0,
    clipDuration: 0,
    clipLoop: true,
    speed: 1,
    transitionProgress: 0,
    sceneLoop: true,
  });

  const [activeTab, setActiveTab] = useState<SidebarTab>('layers');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  );
  const [loading, setLoading] = useState<{ active: boolean; pct: number; label: string }>({
    active: false,
    pct: 0,
    label: '',
  });
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showIOSInstallTip, setShowIOSInstallTip] = useState(false);

  const cameraPassthrough = useCameraPassthrough();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refreshSavedList = useCallback(async () => {
    const list = await listSavedModels();
    setSavedModels(list);
  }, []);

  const mountLoadedModel = useCallback(async (model: LoadedModel) => {
    const customScenes = await loadCustomScenes(model.id);
    const mgr = managerRef.current;
    if (!mgr) return;

    mgr.loadModel(model, customScenes);
    setLoadedModel(model);
    setLayers(mgr.getLayersSnapshot());
    setNodeVisibility(mgr.getNodeVisibilityMap());
    setScenes(mgr.getScenes());
    setSelectedNodeId(null);
  }, []);

  const handleLoadBuffer = useCallback(
    async (params: {
      buffer: ArrayBuffer;
      fileName: string;
      modelId: string;
      isDemo?: boolean;
      persistOffline?: boolean;
    }) => {
      setLoading({ active: true, pct: 5, label: `Abriendo ${params.fileName}…` });
      try {
        // Yield a frame so the loading progress UI paints cleanly before synchronous SKP parsing
        await new Promise((r) => setTimeout(r, 30));
        const model = await loadModelFromBuffer({
          buffer: params.buffer,
          fileName: params.fileName,
          modelId: params.modelId,
          isDemo: params.isDemo,
          onProgress: (pct, label) => setLoading({ active: true, pct, label }),
        });

        await mountLoadedModel(model);

        if (params.persistOffline && params.buffer.byteLength <= 80 * 1024 * 1024) {
          try {
            await saveModelOffline({
              id: params.modelId,
              name: params.fileName,
              format: model.format,
              data: params.buffer,
              thumbnailDataUrl: model.thumbnailDataUrl,
            });
            await refreshSavedList();
          } catch {
            // Quota exceeded or private mode — model still loaded in memory
          }
        }

        const sceneNote =
          model.scenes.length > 0 ? ` · ${model.scenes.length} escenas` : '';
        showToast(
          `Cargado: ${params.fileName} (${model.layers.length} capas${sceneNote})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al cargar el archivo 3D.';
        showToast(`Error: ${msg}`);
      } finally {
        setLoading({ active: false, pct: 0, label: '' });
      }
    },
    [mountLoadedModel, refreshSavedList, showToast],
  );

  const handleFileSelected = useCallback(
    async (file: File) => {
      const fmt = detectModelFormat(file.name);
      if (!fmt) {
        showToast('Formato no compatible. Usa .skp, .glb, .gltf, .dae, .kmz o .obj');
        return;
      }
      const buffer = await file.arrayBuffer();
      const modelId = `file-${file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${file.size}`;
      await handleLoadBuffer({
        buffer,
        fileName: file.name,
        modelId,
        persistOffline: true,
      });
    },
    [handleLoadBuffer, showToast],
  );

  const handleLoadDemo = useCallback(async () => {
    setLoading({ active: true, pct: 8, label: 'Cargando Pabellón Demo (.skp)…' });
    try {
      const res = await fetch('./samples/pabellon-demo.skp');
      if (!res.ok) throw new Error('No se encontró el archivo demo .skp');
      const buffer = await res.arrayBuffer();
      await handleLoadBuffer({
        buffer,
        fileName: 'Pabellon_Arquitectonico.skp',
        modelId: DEMO_MODEL_ID,
        isDemo: true,
        persistOffline: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando demo';
      showToast(msg);
      setLoading({ active: false, pct: 0, label: '' });
    }
  }, [handleLoadBuffer, showToast]);

  const handleLoadSaved = useCallback(
    async (id: string) => {
      const rec = await getSavedModel(id);
      if (!rec) {
        showToast('No se encontró el archivo en la biblioteca offline.');
        return;
      }
      await handleLoadBuffer({
        buffer: rec.data,
        fileName: rec.name,
        modelId: rec.id,
        persistOffline: false,
      });
    },
    [handleLoadBuffer, showToast],
  );

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      await deleteSavedModel(id);
      await refreshSavedList();
      showToast('Archivo eliminado de la memoria offline.');
    },
    [refreshSavedList, showToast],
  );

  const pwa = usePWA(handleFileSelected);

  // Initialize Three.js + WebXR SceneManager once
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const mgr = new SceneManager(container, {
      onTransformChange: (t) => setTransform(t),
      onSelectionChange: (nodeId) => setSelectedNodeId(nodeId),
      onXRStatusChange: (status) => setXRStatus(status),
      onPlaybackChange: (pb) => setPlayback(pb),
      onLayersChanged: (nextLayers) => setLayers(nextLayers),
      onNodeVisibilityChanged: (visMap) => setNodeVisibility(visMap),
      onBackgroundChange: (mode) => setBackgroundMode(mode),
      onEdgesChange: (vis) => setShowEdges(vis),
      onToast: (msg) => showToast(msg),
    });
    managerRef.current = mgr;

    void refreshSavedList();
    void handleLoadDemo();

    return () => {
      mgr.dispose();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background switcher (coordinates WebGL clear alpha + live Camera Passthrough)
  const handleBackgroundChange = useCallback(
    async (mode: BackgroundMode) => {
      const mgr = managerRef.current;
      if (!mgr) return;

      if (mode === 'camera') {
        const ok = await cameraPassthrough.startCamera();
        if (!ok) {
          showToast('No se pudo activar la cámara; usando fondo transparente (Passthrough).');
          mgr.setBackgroundMode('passthrough');
          return;
        }
        mgr.setBackgroundMode('camera');
        showToast('Passthrough con cámara en vivo activado');
        return;
      }

      if (cameraPassthrough.active) {
        cameraPassthrough.stopCamera();
      }
      mgr.setBackgroundMode(mode);
      if (mode === 'passthrough') {
        showToast('Fondo eliminado — Modo Passthrough activo');
      }
    },
    [cameraPassthrough, showToast],
  );

  const handleTogglePassthrough = useCallback(() => {
    const isTransparent = backgroundMode === 'passthrough' || backgroundMode === 'camera';
    void handleBackgroundChange(isTransparent ? 'studio' : 'passthrough');
  }, [backgroundMode, handleBackgroundChange]);

  const handleEnterXR = useCallback(
    async (mode: 'immersive-ar' | 'immersive-vr') => {
      const mgr = managerRef.current;
      if (!mgr) return;

      if (xrStatus.activeMode === mode) {
        await mgr.exitXR();
        return;
      }

      const supported = mode === 'immersive-ar' ? xrStatus.arSupported : xrStatus.vrSupported;
      if (!supported) {
        if (mode === 'immersive-ar') {
          showToast(
            'WebXR AR nativo no detectado en este dispositivo. Activando Passthrough por cámara…',
          );
          await handleBackgroundChange('camera');
        } else {
          showToast(
            'No se detectó un visor WebXR VR (como Meta Quest, Apple Vision Pro o emulador WebXR).',
          );
        }
        return;
      }

      try {
        if (cameraPassthrough.active) cameraPassthrough.stopCamera();
        setDrawerOpen(false);
        await mgr.enterXR(mode, xrOverlayRef.current);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo iniciar la sesión WebXR.';
        showToast(msg);
      }
    },
    [cameraPassthrough, handleBackgroundChange, showToast, xrStatus],
  );

  // Layer & Element handlers
  const handleToggleLayer = useCallback((layerId: string, visible: boolean) => {
    managerRef.current?.setLayerVisible(layerId, visible);
  }, []);

  const handleIsolateLayer = useCallback((layerId: string) => {
    managerRef.current?.isolateLayer(layerId);
  }, []);

  const handleToggleNode = useCallback((nodeId: string, visible: boolean) => {
    const mgr = managerRef.current;
    if (!mgr) return;
    mgr.setNodeVisible(nodeId, visible);
    setNodeVisibility(mgr.getNodeVisibilityMap());
  }, []);

  const handleIsolateNode = useCallback((nodeId: string) => {
    const mgr = managerRef.current;
    if (!mgr) return;
    mgr.isolateNode(nodeId);
    setNodeVisibility(mgr.getNodeVisibilityMap());
  }, []);

  const handleShowAllNodes = useCallback(() => {
    const mgr = managerRef.current;
    if (!mgr) return;
    mgr.showAllNodes();
    setNodeVisibility(mgr.getNodeVisibilityMap());
  }, []);

  // Scene handlers
  const handleCaptureScene = useCallback(
    async (name: string) => {
      const mgr = managerRef.current;
      if (!mgr || !loadedModel) return;
      mgr.captureCurrentScene(name);
      const all = mgr.getScenes();
      setScenes(all);
      const customOnly = all.filter((s) => s.source === 'custom');
      try {
        await saveCustomScenes(loadedModel.id, customOnly);
      } catch {
        // Ignore storage error
      }
      showToast(`Escena "${name}" guardada offline`);
    },
    [loadedModel, showToast],
  );

  const handleDeleteCustomScene = useCallback(
    async (sceneId: string) => {
      const mgr = managerRef.current;
      if (!mgr || !loadedModel) return;
      const next = mgr.getScenes().filter((s) => s.id !== sceneId);
      mgr.setScenes(next);
      setScenes(next);
      const customOnly = next.filter((s) => s.source === 'custom');
      try {
        await saveCustomScenes(loadedModel.id, customOnly);
      } catch {
        // Ignore
      }
    },
    [loadedModel],
  );

  // Transform mode
  const handleTransformMode = useCallback((mode: TransformMode) => {
    setTransformMode(mode);
    managerRef.current?.setTransformMode(mode);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const key = ev.key.toLowerCase();
      if (key === 'q') handleTransformMode('none');
      else if (key === 'g') handleTransformMode('translate');
      else if (key === 'r') handleTransformMode('rotate');
      else if (key === 's') handleTransformMode('scale');
      else if (key === 'b') handleTogglePassthrough();
      else if (key === 'e') {
        const next = !showEdges;
        setShowEdges(next);
        managerRef.current?.setCadEdgesVisible(next);
      } else if (key === 'x') {
        const next = !xrayMode;
        setXrayMode(next);
        managerRef.current?.setXRayMode(next);
      } else if (key === 'f') {
        managerRef.current?.fitCameraToModel();
      } else if (ev.code === 'Space') {
        ev.preventDefault();
        managerRef.current?.toggleScenePlayback();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePassthrough, handleTransformMode, showEdges, xrayMode]);

  // Global drag & drop
  const handleDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault();
      setIsDraggingFile(false);
      const file = ev.dataTransfer.files?.[0];
      if (file) void handleFileSelected(file);
    },
    [handleFileSelected],
  );

  const clipNames = useMemo(
    () => (loadedModel?.animationClips ?? []).map((c, i) => c.name || `clip_${i}`),
    [loadedModel],
  );

  const activeSceneName = useMemo(
    () => scenes.find((s) => s.id === playback.activeSceneId)?.name ?? null,
    [scenes, playback.activeSceneId],
  );

  const isInXR = xrStatus.activeMode !== 'none';
  const isTransparentBg = backgroundMode === 'passthrough' || backgroundMode === 'camera';

  return (
    <div
      className={`app-shell ${isTransparentBg ? 'is-transparent-bg' : ''} ${
        backgroundMode === 'passthrough' && !isInXR ? 'is-checker-bg' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingFile(false);
      }}
      onDrop={handleDrop}
    >
      {/* Live rear-camera passthrough video (fallback for non-WebXR devices) */}
      <video
        ref={cameraPassthrough.videoRef}
        className={`camera-passthrough-video ${cameraPassthrough.active ? 'is-visible' : ''}`}
        playsInline
        muted
        autoPlay
      />

      {/* WebGL / WebXR Viewport */}
      <div ref={viewportRef} className="viewport-canvas-host" />

      {/* Hidden global file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".skp,.glb,.gltf,.dae,.kmz,.obj"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFileSelected(f);
          e.target.value = '';
        }}
      />

      {/* HUD & WebXR DOM Overlay Root */}
      <div ref={xrOverlayRef} className="xr-overlay-root">
        {/* Top Bar */}
        <header className="top-bar glass-surface">
          <div className="top-bar-left">
            <div className="brand-mark">
              <Box size={18} />
              <span>SkpXR</span>
            </div>

            {loadedModel && (
              <div className="model-chip" title={loadedModel.name}>
                <span className="format-pill">.{loadedModel.format.toUpperCase()}</span>
                <span className="model-chip-name">{loadedModel.name}</span>
              </div>
            )}

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => fileInputRef.current?.click()}
              title="Abrir archivo SketchUp (.skp, .glb, .dae, .kmz, .obj)"
            >
              <FileUp size={14} />
              <span className="hide-xs">Abrir</span>
            </button>
          </div>

          <div className="top-bar-center">
            {/* Background & Passthrough Selector */}
            <div className="bg-switcher" role="group" aria-label="Modo de fondo y passthrough">
              <button
                type="button"
                className={`bg-pill ${backgroundMode === 'studio' ? 'is-active' : ''}`}
                onClick={() => void handleBackgroundChange('studio')}
                title="Fondo Estudio Claro"
              >
                <Sun size={14} />
                <span className="hide-md">Estudio</span>
              </button>
              <button
                type="button"
                className={`bg-pill ${backgroundMode === 'dark' ? 'is-active' : ''}`}
                onClick={() => void handleBackgroundChange('dark')}
                title="Fondo Oscuro CAD"
              >
                <Moon size={14} />
                <span className="hide-md">Oscuro</span>
              </button>
              <button
                type="button"
                className={`bg-pill ${backgroundMode === 'passthrough' ? 'is-active is-passthrough' : ''}`}
                onClick={() => void handleBackgroundChange('passthrough')}
                title="Quitar fondo / Passthrough transparente (B)"
              >
                <Scan size={14} />
                <span>Passthrough</span>
              </button>
              {!isInXR && (
                <button
                  type="button"
                  className={`bg-pill ${backgroundMode === 'camera' ? 'is-active is-passthrough' : ''}`}
                  onClick={() => void handleBackgroundChange('camera')}
                  title="Passthrough con cámara del dispositivo"
                >
                  <Camera size={14} />
                  <span className="hide-md">Cámara</span>
                </button>
              )}
            </div>
          </div>

          <div className="top-bar-right">
            {/* Visual inspection toggles */}
            <button
              type="button"
              className={`icon-pill ${showEdges ? 'is-active' : ''}`}
              title="Mostrar/ocultar aristas CAD de SketchUp (E)"
              onClick={() => {
                const next = !showEdges;
                setShowEdges(next);
                managerRef.current?.setCadEdgesVisible(next);
              }}
            >
              <Sparkles size={14} />
              <span className="hide-lg">Aristas</span>
            </button>

            <button
              type="button"
              className={`icon-pill ${xrayMode ? 'is-active' : ''}`}
              title="Modo Rayos X semitransparente (X)"
              onClick={() => {
                const next = !xrayMode;
                setXrayMode(next);
                managerRef.current?.setXRayMode(next);
              }}
            >
              <Eye size={14} />
              <span className="hide-lg">Rayos X</span>
            </button>

            {/* WebXR Launch Buttons */}
            <button
              type="button"
              className={`btn btn-sm btn-xr-ar ${xrStatus.activeMode === 'immersive-ar' ? 'is-live' : ''}`}
              onClick={() => void handleEnterXR('immersive-ar')}
              title={
                xrStatus.arSupported
                  ? 'Iniciar WebXR con Passthrough real (puedes alternar el fondo dentro del visor)'
                  : 'Activar AR / Cámara Passthrough'
              }
            >
              <Scan size={14} />
              <span>{xrStatus.activeMode === 'immersive-ar' ? 'Salir XR' : 'XR Passthrough'}</span>
            </button>

            {xrStatus.vrSupported && !xrStatus.arSupported && (
              <button
                type="button"
                className={`btn btn-sm btn-xr-vr ${xrStatus.activeMode === 'immersive-vr' ? 'is-live' : ''}`}
                onClick={() => void handleEnterXR('immersive-vr')}
                title="Iniciar sesión WebXR VR"
              >
                <Glasses size={14} />
                <span>{xrStatus.activeMode === 'immersive-vr' ? 'Salir VR' : 'VR'}</span>
              </button>
            )}

            {/* PWA Install Button */}
            {pwa.canInstall && (
              <button
                type="button"
                className="btn btn-sm btn-install"
                onClick={() => void pwa.installApp()}
                title="Instalar SkpXR como app offline (PWA)"
              >
                <Download size={14} />
                <span className="hide-md">Instalar App</span>
              </button>
            )}

            {!pwa.canInstall && !pwa.isInstalled && pwa.isIOS && (
              <button
                type="button"
                className="btn btn-sm btn-install"
                onClick={() => setShowIOSInstallTip(true)}
                title="Cómo instalar en iOS"
              >
                <Download size={14} />
                <span className="hide-md">Instalar</span>
              </button>
            )}

            {/* Online / Offline status indicator */}
            <div
              className={`status-dot-chip ${pwa.isOnline ? 'is-online' : 'is-offline'}`}
              title={
                pwa.isOnline
                  ? 'Conectado · Listo para funcionar sin internet'
                  : 'Modo sin conexión (Offline activo)'
              }
            >
              {pwa.isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span className="hide-lg">{pwa.isOnline ? 'Offline listo' : 'Sin conexión'}</span>
            </div>

            <button
              type="button"
              className="icon-btn-header"
              onClick={() => setDrawerOpen((v) => !v)}
              title={drawerOpen ? 'Ocultar panel inspector' : 'Mostrar panel inspector'}
            >
              {drawerOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </button>
          </div>
        </header>

        {/* Right Collapsible Inspector Drawer */}
        {drawerOpen && (
          <aside className="inspector-drawer glass-surface">
            <nav className="drawer-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'layers'}
                className={`drawer-tab ${activeTab === 'layers' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('layers')}
              >
                <Layers size={15} />
                <span>Capas</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'elements'}
                className={`drawer-tab ${activeTab === 'elements' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('elements')}
              >
                <FolderTree size={15} />
                <span>Elementos</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'transform'}
                className={`drawer-tab ${activeTab === 'transform' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('transform')}
              >
                <Sliders size={15} />
                <span>3D</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'scenes'}
                className={`drawer-tab ${activeTab === 'scenes' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('scenes')}
              >
                <Clapperboard size={15} />
                <span>Escenas</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'files'}
                className={`drawer-tab ${activeTab === 'files' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('files')}
              >
                <HardDrive size={15} />
                <span>Archivos</span>
              </button>
            </nav>

            <div className="drawer-body">
              {activeTab === 'layers' && (
                <LayersPanel
                  layers={layers}
                  onToggleLayer={handleToggleLayer}
                  onIsolateLayer={handleIsolateLayer}
                  onShowAll={() => managerRef.current?.showAllLayers()}
                  onHideAll={() => managerRef.current?.hideAllLayers()}
                />
              )}

              {activeTab === 'elements' && (
                <ElementsTreePanel
                  tree={loadedModel?.tree ?? null}
                  nodeVisibility={nodeVisibility}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => managerRef.current?.selectNode(id)}
                  onToggleNode={handleToggleNode}
                  onIsolateNode={handleIsolateNode}
                  onFocusNode={(id) => managerRef.current?.focusOnNode(id)}
                  onShowAllNodes={handleShowAllNodes}
                />
              )}

              {activeTab === 'transform' && (
                <TransformPanel
                  transformMode={transformMode}
                  transform={transform}
                  dimensionsMeters={loadedModel?.stats.dimensionsMeters}
                  isXR={isInXR}
                  onChangeMode={handleTransformMode}
                  onChangeTransform={(next) => managerRef.current?.setModelTransform(next)}
                  onScalePreset={(preset) => managerRef.current?.applyScalePreset(preset)}
                  onSnapToFloor={() => managerRef.current?.snapToFloor()}
                  onReset={() => managerRef.current?.resetTransform()}
                  onFitCamera={() => managerRef.current?.fitCameraToModel()}
                />
              )}

              {activeTab === 'scenes' && (
                <ScenesPanel
                  scenes={scenes}
                  clipNames={clipNames}
                  playback={playback}
                  onSelectScene={(id) => managerRef.current?.goToScene(id)}
                  onTogglePlay={() => managerRef.current?.toggleScenePlayback()}
                  onStepScene={(d) => managerRef.current?.stepScene(d)}
                  onSetSpeed={(sp) => managerRef.current?.setPlaybackSpeed(sp)}
                  onToggleLoop={(loop) => managerRef.current?.setSceneLoop(loop)}
                  onCaptureScene={(name) => void handleCaptureScene(name)}
                  onDeleteCustomScene={(id) => void handleDeleteCustomScene(id)}
                  onSelectClip={(name) => managerRef.current?.selectAnimationClip(name, true)}
                  onSeekClip={(sec) => managerRef.current?.seekAnimationClip(sec)}
                />
              )}

              {activeTab === 'files' && (
                <LibraryPanel
                  currentModelId={loadedModel?.id ?? null}
                  currentModelName={loadedModel?.name ?? null}
                  currentStats={loadedModel?.stats ?? null}
                  savedModels={savedModels}
                  onUploadFile={(f) => void handleFileSelected(f)}
                  onLoadDemo={() => void handleLoadDemo()}
                  onLoadSaved={(id) => void handleLoadSaved(id)}
                  onDeleteSaved={(id) => void handleDeleteSaved(id)}
                />
              )}
            </div>
          </aside>
        )}

        {/* Bottom Floating Quick Toolbar */}
        <footer className="bottom-dock glass-surface">
          {!isInXR ? (
            <div className="dock-group" role="group" aria-label="Herramientas de transformación">
              <button
                type="button"
                className={`dock-btn ${transformMode === 'none' ? 'is-active' : ''}`}
                onClick={() => handleTransformMode('none')}
                title="Órbita (Q)"
              >
                <Orbit size={16} />
                <span className="hide-xs">Órbita</span>
              </button>
              <button
                type="button"
                className={`dock-btn ${transformMode === 'translate' ? 'is-active' : ''}`}
                onClick={() => handleTransformMode('translate')}
                title="Mover modelo (G)"
              >
                <Move size={16} />
                <span className="hide-xs">Mover</span>
              </button>
              <button
                type="button"
                className={`dock-btn ${transformMode === 'rotate' ? 'is-active' : ''}`}
                onClick={() => handleTransformMode('rotate')}
                title="Rotar modelo (R)"
              >
                <RotateCw size={16} />
                <span className="hide-xs">Rotar</span>
              </button>
              <button
                type="button"
                className={`dock-btn ${transformMode === 'scale' ? 'is-active' : ''}`}
                onClick={() => handleTransformMode('scale')}
                title="Escalar modelo (S)"
              >
                <Scaling size={16} />
                <span className="hide-xs">Escalar</span>
              </button>
            </div>
          ) : (
            <div className="dock-group">
              <button
                type="button"
                className={`dock-btn ${xrStatus.placementActive ? 'is-active' : ''}`}
                onClick={() => managerRef.current?.setARPlacementMode(!xrStatus.placementActive)}
              >
                <Crosshair size={16} />
                <span>{xrStatus.placementActive ? 'Toca el suelo' : 'Reubicar AR'}</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                onClick={() =>
                  managerRef.current?.setModelTransform({
                    rotationDeg: [
                      transform.rotationDeg[0],
                      transform.rotationDeg[1] + 30,
                      transform.rotationDeg[2],
                    ],
                  })
                }
              >
                <RotateCw size={16} />
                <span>+30°</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                onClick={() =>
                  managerRef.current?.setModelTransform({
                    scale: Number((transform.scale * 1.2).toFixed(4)),
                  })
                }
              >
                <Scaling size={16} />
                <span>+</span>
              </button>
              <button
                type="button"
                className="dock-btn"
                onClick={() =>
                  managerRef.current?.setModelTransform({
                    scale: Number((transform.scale * 0.82).toFixed(4)),
                  })
                }
              >
                <Scaling size={16} />
                <span>−</span>
              </button>
            </div>
          )}

          <div className="dock-divider" />

          {/* Quick Scene Transport */}
          <div className="dock-group">
            <button
              type="button"
              className="dock-btn"
              disabled={scenes.length === 0}
              onClick={() => managerRef.current?.stepScene(-1)}
              title="Escena anterior"
            >
              <SkipBack size={15} />
            </button>
            <button
              type="button"
              className={`dock-btn ${playback.isPlaying ? 'is-active' : ''}`}
              disabled={scenes.length === 0 && clipNames.length === 0}
              onClick={() => managerRef.current?.toggleScenePlayback()}
              title="Reproducir / Pausar escenas (Espacio)"
            >
              {playback.isPlaying ? <Pause size={15} /> : <Play size={15} />}
              <span className="dock-scene-label">
                {activeSceneName ?? (scenes.length > 0 ? 'Escenas' : 'Sin escenas')}
              </span>
            </button>
            <button
              type="button"
              className="dock-btn"
              disabled={scenes.length === 0}
              onClick={() => managerRef.current?.stepScene(1)}
              title="Siguiente escena"
            >
              <SkipForward size={15} />
            </button>
          </div>
        </footer>

        {/* PWA Offline-ready / Update banners */}
        {pwa.offlineReady && (
          <div className="pwa-banner glass-surface">
            <CheckCircle2 size={16} className="banner-icon-ok" />
            <span>App lista para funcionar 100% sin conexión a internet.</span>
            <button type="button" className="icon-btn" onClick={pwa.dismissOfflineReady}>
              <X size={14} />
            </button>
          </div>
        )}

        {pwa.needRefresh && (
          <div className="pwa-banner glass-surface">
            <RefreshCw size={16} className="banner-icon-accent" />
            <span>Nueva versión disponible de SkpXR.</span>
            <button type="button" className="btn btn-xs btn-accent" onClick={pwa.updateApp}>
              Actualizar
            </button>
          </div>
        )}

        {/* Toast Notification */}
        {toast && <div className="toast-pill glass-surface">{toast}</div>}

        {/* Loading Overlay */}
        {loading.active && (
          <div className="loading-backdrop">
            <div className="loading-card glass-surface">
              <div className="spinner-ring" />
              <div className="loading-label">{loading.label}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${loading.pct}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Global Drag & Drop Overlay */}
        {isDraggingFile && (
          <div className="drop-overlay">
            <div className="drop-box glass-surface">
              <Upload size={38} />
              <strong>Suelta tu archivo SketchUp aquí</strong>
              <span>Compatible con .SKP, .GLB, .GLTF, .DAE, .KMZ y .OBJ</span>
            </div>
          </div>
        )}

        {/* iOS Install Modal */}
        {showIOSInstallTip && (
          <div className="loading-backdrop" onClick={() => setShowIOSInstallTip(false)}>
            <div className="modal-card glass-surface" onClick={(e) => e.stopPropagation()}>
              <div className="panel-header-row">
                <strong>Instalar SkpXR en iPhone / iPad</strong>
                <button type="button" className="icon-btn" onClick={() => setShowIOSInstallTip(false)}>
                  <X size={16} />
                </button>
              </div>
              <p className="modal-text">
                1. Pulsa el botón <strong>Compartir</strong> en Safari.<br />
                2. Selecciona <strong>Añadir a pantalla de inicio</strong>.<br />
                3. Abre SkpXR desde tu pantalla de inicio: funcionará sin conexión a internet.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
