import * as THREE from 'three';
import type {
  AnimationPlaybackState,
  BackgroundMode,
  LayerInfo,
  ViewerScene,
} from '../types/viewer';

export type SpatialPanelAction =
  | { type: 'toggle-passthrough' }
  | { type: 'set-scale-preset'; preset: 'fit' | '1:1' | '1:10' | '1:20' | '1:50' }
  | { type: 'rotate-yaw'; deltaDeg: number }
  | { type: 'move-y'; deltaMeters: number }
  | { type: 'reset-transform' }
  | { type: 'snap-floor' }
  | { type: 'toggle-layer'; layerId: string }
  | { type: 'show-all-layers' }
  | { type: 'select-scene'; sceneId: string }
  | { type: 'toggle-play-scenes' }
  | { type: 'step-scene'; delta: -1 | 1 }
  | { type: 'toggle-edges' }
  | { type: 'exit-xr' };

interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: SpatialPanelAction | { type: 'switch-tab'; tab: PanelTab } | { type: 'scroll-layers'; delta: number } | { type: 'scroll-scenes'; delta: number };
}

type PanelTab = 'transform' | 'layers' | 'scenes';

const CANVAS_W = 1024;
const CANVAS_H = 680;
const PANEL_W = 0.68;
const PANEL_H = (PANEL_W * CANVAS_H) / CANVAS_W;

export class XRSpatialPanel {
  public readonly group: THREE.Group;
  public readonly mesh: THREE.Mesh;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private regions: HitRegion[] = [];
  private hoveredId: string | null = null;
  private activeTab: PanelTab = 'transform';
  private layerScroll = 0;
  private sceneScroll = 0;

  private modelName = 'Sin modelo';
  private backgroundMode: BackgroundMode = 'passthrough';
  private layers: LayerInfo[] = [];
  private scenes: ViewerScene[] = [];
  private playback: AnimationPlaybackState = {
    isPlaying: false,
    activeSceneId: null,
    activeClipName: null,
    clipTime: 0,
    clipDuration: 0,
    clipLoop: true,
    speed: 1,
    transitionProgress: 0,
    sceneLoop: true,
  };
  private currentScale = 1;
  private showEdges = true;

  private onAction: (action: SpatialPanelAction) => void;

  constructor(onAction: (action: SpatialPanelAction) => void) {
    this.onAction = onAction;
    this.group = new THREE.Group();
    this.group.name = 'XRSpatialPanel';
    this.group.visible = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geom = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'XRSpatialPanelSurface';
    this.group.add(this.mesh);

    // Subtle glowing backing border
    const borderGeom = new THREE.PlaneGeometry(PANEL_W + 0.012, PANEL_H + 0.012);
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const border = new THREE.Mesh(borderGeom, borderMat);
    border.position.z = -0.002;
    this.group.add(border);

    this.render();
  }

  public updateState(state: {
    modelName?: string;
    backgroundMode?: BackgroundMode;
    layers?: LayerInfo[];
    scenes?: ViewerScene[];
    playback?: AnimationPlaybackState;
    scale?: number;
    showEdges?: boolean;
  }): void {
    if (state.modelName !== undefined) this.modelName = state.modelName;
    if (state.backgroundMode !== undefined) this.backgroundMode = state.backgroundMode;
    if (state.layers !== undefined) {
      this.layers = state.layers;
      this.layerScroll = Math.min(this.layerScroll, Math.max(0, this.layers.length - 6));
    }
    if (state.scenes !== undefined) {
      this.scenes = state.scenes;
      this.sceneScroll = Math.min(this.sceneScroll, Math.max(0, this.scenes.length - 5));
    }
    if (state.playback !== undefined) this.playback = state.playback;
    if (state.scale !== undefined) this.currentScale = state.scale;
    if (state.showEdges !== undefined) this.showEdges = state.showEdges;
    this.render();
  }

  public placeInFrontOfCamera(camera: THREE.Camera): void {
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-4) camDir.set(0, 0, -1);
    camDir.normalize();

    const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
    const targetPos = camPos
      .clone()
      .addScaledVector(camDir, 1.05)
      .addScaledVector(right, -0.45);
    targetPos.y = Math.max(0.85, camPos.y - 0.12);

    this.group.position.copy(targetPos);
    this.group.lookAt(camPos.x, targetPos.y + 0.04, camPos.z);
  }

  public handleRayHover(uv: THREE.Vector2 | null): boolean {
    if (!uv) {
      if (this.hoveredId !== null) {
        this.hoveredId = null;
        this.render();
      }
      return false;
    }
    const px = uv.x * CANVAS_W;
    const py = (1 - uv.y) * CANVAS_H;
    const hit = this.findRegion(px, py);
    const nextId = hit ? hit.id : null;
    if (nextId !== this.hoveredId) {
      this.hoveredId = nextId;
      this.render();
    }
    return Boolean(hit);
  }

  public handleRayClick(uv: THREE.Vector2): boolean {
    const px = uv.x * CANVAS_W;
    const py = (1 - uv.y) * CANVAS_H;
    const hit = this.findRegion(px, py);
    if (!hit) return false;

    const act = hit.action;
    if (act.type === 'switch-tab') {
      this.activeTab = act.tab;
      this.render();
      return true;
    }
    if (act.type === 'scroll-layers') {
      const maxScroll = Math.max(0, this.layers.length - 6);
      this.layerScroll = Math.max(0, Math.min(maxScroll, this.layerScroll + act.delta));
      this.render();
      return true;
    }
    if (act.type === 'scroll-scenes') {
      const maxScroll = Math.max(0, this.scenes.length - 5);
      this.sceneScroll = Math.max(0, Math.min(maxScroll, this.sceneScroll + act.delta));
      this.render();
      return true;
    }

    this.onAction(act);
    return true;
  }

  private findRegion(px: number, py: number): HitRegion | undefined {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        return r;
      }
    }
    return undefined;
  }

  private drawRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private drawButton(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: HitRegion['action'],
    opts: { active?: boolean; danger?: boolean; accent?: boolean; sublabel?: string; swatch?: string } = {},
  ): void {
    const ctx = this.ctx;
    this.regions.push({ id, x, y, w, h, action });
    const hovered = this.hoveredId === id;

    this.drawRoundRect(x, y, w, h, 14);
    if (opts.danger) {
      ctx.fillStyle = hovered ? '#ef4444' : 'rgba(239, 68, 68, 0.25)';
    } else if (opts.active || opts.accent) {
      ctx.fillStyle = hovered ? '#38bdf8' : 'rgba(56, 189, 248, 0.28)';
    } else {
      ctx.fillStyle = hovered ? 'rgba(148, 163, 184, 0.34)' : 'rgba(30, 41, 59, 0.88)';
    }
    ctx.fill();

    ctx.lineWidth = hovered ? 2.5 : 1.5;
    ctx.strokeStyle = opts.danger
      ? 'rgba(248, 113, 113, 0.7)'
      : opts.active || opts.accent
        ? 'rgba(56, 189, 248, 0.85)'
        : 'rgba(148, 163, 184, 0.25)';
    ctx.stroke();

    let textX = x + w / 2;
    ctx.textAlign = 'center';
    if (opts.swatch) {
      ctx.fillStyle = opts.swatch;
      ctx.beginPath();
      ctx.arc(x + 26, y + h / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      textX = x + 48;
    }

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    const maxW = opts.swatch ? w - 120 : w - 20;
    const clipped = this.clipText(label, maxW);
    ctx.fillText(clipped, textX, opts.sublabel ? y + h / 2 - 10 : y + h / 2);

    if (opts.sublabel) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(opts.sublabel, textX, y + h / 2 + 15);
    }
  }

  private clipText(text: string, maxWidth: number): string {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 3 && ctx.measureText(`${t}…`).width > maxWidth) {
      t = t.slice(0, -1);
    }
    return `${t}…`;
  }

  public render(): void {
    const ctx = this.ctx;
    this.regions = [];
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Glass backdrop
    this.drawRoundRect(6, 6, CANVAS_W - 12, CANVAS_H - 12, 28);
    ctx.fillStyle = 'rgba(11, 17, 27, 0.92)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.stroke();

    // Header
    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 24px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SkpXR Panel Espacial', 32, 46);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 19px system-ui, -apple-system, sans-serif';
    ctx.fillText(this.clipText(this.modelName, 400), 32, 78);

    const isPassthrough = this.backgroundMode === 'passthrough';
    this.drawButton(
      'hdr-pt',
      500,
      24,
      280,
      58,
      isPassthrough ? 'Passthrough: ON' : 'Fondo Virtual: ON',
      { type: 'toggle-passthrough' },
      { active: isPassthrough },
    );

    this.drawButton('hdr-exit', 800, 24, 192, 58, 'Salir XR', { type: 'exit-xr' }, { danger: true });

    // Divider
    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.fillRect(28, 102, CANVAS_W - 56, 2);

    // Tabs
    const tabs: Array<{ id: PanelTab; label: string }> = [
      { id: 'transform', label: 'Transformar' },
      { id: 'layers', label: `Capas (${this.layers.length})` },
      { id: 'scenes', label: `Escenas (${this.scenes.length})` },
    ];
    tabs.forEach((t, idx) => {
      this.drawButton(
        `tab-${t.id}`,
        32 + idx * 324,
        118,
        308,
        54,
        t.label,
        { type: 'switch-tab', tab: t.id },
        { active: this.activeTab === t.id },
      );
    });

    if (this.activeTab === 'transform') {
      this.renderTransformTab();
    } else if (this.activeTab === 'layers') {
      this.renderLayersTab();
    } else {
      this.renderScenesTab();
    }

    // Footer tip
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 17px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      'Agarre 1 mano: Mover/Rotar  •  2 manos: Escalar  •  Stick Izq: Mover  •  Stick Der: Rotar/Escalar',
      CANVAS_W / 2,
      CANVAS_H - 26,
    );

    this.texture.needsUpdate = true;
  }

  private renderTransformTab(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 19px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Escala actual: ${(this.currentScale * 100).toFixed(0)}%`, 36, 206);

    const presets: Array<{ label: string; preset: 'fit' | '1:1' | '1:10' | '1:20' | '1:50' }> = [
      { label: 'Ajustar', preset: 'fit' },
      { label: '1:1 Real', preset: '1:1' },
      { label: '1:10', preset: '1:10' },
      { label: '1:20', preset: '1:20' },
      { label: '1:50', preset: '1:50' },
    ];
    presets.forEach((p, idx) => {
      this.drawButton(
        `scale-${p.preset}`,
        32 + idx * 194,
        228,
        180,
        68,
        p.label,
        { type: 'set-scale-preset', preset: p.preset },
      );
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 19px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Rotación y Altura', 36, 330);

    this.drawButton('rot-m45', 32, 352, 224, 68, '↺ -45°', { type: 'rotate-yaw', deltaDeg: -45 });
    this.drawButton('rot-p45', 274, 352, 224, 68, '↻ +45°', { type: 'rotate-yaw', deltaDeg: 45 });
    this.drawButton('move-up', 526, 352, 224, 68, '↑ Subir +15cm', { type: 'move-y', deltaMeters: 0.15 });
    this.drawButton('move-dn', 768, 352, 224, 68, '↓ Bajar -15cm', { type: 'move-y', deltaMeters: -0.15 });

    this.drawButton('snap-fl', 32, 456, 308, 76, 'Apoyar en Suelo', { type: 'snap-floor' }, { accent: true });
    this.drawButton(
      'tog-edge',
      358,
      456,
      308,
      76,
      this.showEdges ? 'Aristas CAD: ON' : 'Aristas CAD: OFF',
      { type: 'toggle-edges' },
      { active: this.showEdges },
    );
    this.drawButton('reset-tr', 684, 456, 308, 76, 'Restablecer Posición', { type: 'reset-transform' });
  }

  private renderLayersTab(): void {
    const visibleSlice = this.layers.slice(this.layerScroll, this.layerScroll + 6);
    this.drawButton('lyr-all', 32, 192, 240, 48, 'Mostrar Todas', { type: 'show-all-layers' }, { accent: true });
    this.drawButton('lyr-up', 730, 192, 120, 48, '▲ Subir', { type: 'scroll-layers', delta: -3 });
    this.drawButton('lyr-dn', 868, 192, 124, 48, '▼ Bajar', { type: 'scroll-layers', delta: 3 });

    visibleSlice.forEach((layer, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = 32 + col * 488;
      const by = 258 + row * 116;
      this.drawButton(
        `layer-${layer.id}`,
        bx,
        by,
        472,
        98,
        layer.name,
        { type: 'toggle-layer', layerId: layer.id },
        {
          active: layer.visible,
          swatch: layer.color,
          sublabel: `${layer.visible ? 'Visible' : 'Oculta'}  •  ${layer.entityCount} elem.`,
        },
      );
    });
  }

  private renderScenesTab(): void {
    this.drawButton(
      'sc-play',
      32,
      192,
      340,
      58,
      this.playback.isPlaying ? '⏸ Pausar Animación' : '▶ Reproducir Escenas',
      { type: 'toggle-play-scenes' },
      { accent: true },
    );
    this.drawButton('sc-prev', 390, 192, 148, 58, '⏮ Ant.', { type: 'step-scene', delta: -1 });
    this.drawButton('sc-next', 554, 192, 148, 58, 'Sig. ⏭', { type: 'step-scene', delta: 1 });
    this.drawButton('sc-up', 740, 192, 118, 58, '▲', { type: 'scroll-scenes', delta: -2 });
    this.drawButton('sc-dn', 874, 192, 118, 58, '▼', { type: 'scroll-scenes', delta: 2 });

    if (this.scenes.length === 0) {
      const ctx = this.ctx;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Este modelo no contiene escenas guardadas.', CANVAS_W / 2, 390);
      return;
    }

    const visibleSlice = this.scenes.slice(this.sceneScroll, this.sceneScroll + 5);
    visibleSlice.forEach((sc, idx) => {
      const by = 268 + idx * 72;
      const isActive = this.playback.activeSceneId === sc.id;
      this.drawButton(
        `scene-${sc.id}`,
        32,
        by,
        960,
        60,
        `${this.sceneScroll + idx + 1}. ${sc.name}`,
        { type: 'select-scene', sceneId: sc.id },
        { active: isActive },
      );
    });
  }

  public dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
