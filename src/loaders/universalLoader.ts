import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { unzipSync } from 'fflate';
import type {
  LayerInfo,
  LoadedModel,
  ModelFormat,
  SceneNodeInfo,
  ViewerScene,
} from '../types/viewer';
import { loadSkpFromBuffer } from './skpLoader';

const LAYER_PALETTE = [
  '#38bdf8',
  '#818cf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#fb923c',
  '#a78bfa',
  '#2dd4bf',
  '#f87171',
  '#60a5fa',
];

export function detectModelFormat(fileName: string): ModelFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'skp') return 'skp';
  if (ext === 'glb') return 'glb';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'dae') return 'dae';
  if (ext === 'kmz') return 'kmz';
  if (ext === 'obj') return 'obj';
  return null;
}

function guessMimeFromName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function finalizeGenericObject(params: {
  modelId: string;
  fileName: string;
  format: ModelFormat;
  fileSize: number;
  objectRoot: THREE.Object3D;
  animations: THREE.AnimationClip[];
  cameras?: THREE.Camera[];
}): LoadedModel {
  const { modelId, fileName, format, fileSize, objectRoot, animations, cameras = [] } = params;

  const contentRoot = new THREE.Group();
  contentRoot.name = fileName;
  contentRoot.add(objectRoot);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  const layerMap = new Map<string, LayerInfo>();
  const ensureLayer = (name: string): LayerInfo => {
    const clean = name.trim() || 'Capa Base';
    const existing = layerMap.get(clean);
    if (existing) return existing;
    const info: LayerInfo = {
      id: clean,
      name: clean,
      visible: true,
      defaultVisible: true,
      color: LAYER_PALETTE[layerMap.size % LAYER_PALETTE.length],
      entityCount: 0,
    };
    layerMap.set(clean, info);
    return info;
  };

  const nodeMap = new Map<string, THREE.Object3D>();
  const matSet = new Set<string>();
  let nodeCounter = 0;
  let totalMeshes = 0;
  let totalTriangles = 0;
  let totalVertices = 0;

  const walkObj = (
    obj: THREE.Object3D,
    depth: number,
    inheritedLayer: string,
  ): SceneNodeInfo => {
    const isRoot = depth === 0;
    const nodeId = isRoot ? 'node-root' : `node-${++nodeCounter}`;

    const userDataLayer =
      (typeof obj.userData?.layer === 'string' && obj.userData.layer) ||
      (typeof obj.userData?.tag === 'string' && obj.userData.tag) ||
      (typeof obj.userData?.sketchupLayer === 'string' && obj.userData.sketchupLayer);

    // Derive logical layer from metadata or top-level group name
    let layerName = inheritedLayer;
    if (userDataLayer) {
      layerName = userDataLayer;
    } else if (depth === 1 && obj.name) {
      layerName = obj.name.replace(/[_-]+/g, ' ').trim();
    } else if (!layerName && obj instanceof THREE.Mesh) {
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      layerName = mat?.name ? `Material: ${mat.name}` : 'Geometría';
    }
    const layerInfo = ensureLayer(layerName || 'Capa Base');

    let meshCount = 0;
    let triangleCount = 0;

    if (obj instanceof THREE.Mesh) {
      const geom = obj.geometry;
      const posAttr = geom.getAttribute('position');
      const verts = posAttr ? posAttr.count : 0;
      const tris = geom.index ? Math.floor(geom.index.count / 3) : Math.floor(verts / 3);
      meshCount = 1;
      triangleCount = tris;
      totalMeshes += 1;
      totalTriangles += tris;
      totalVertices += verts;
      layerInfo.entityCount += 1;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let hasTransparent = false;
      for (const m of mats) {
        if (!m) continue;
        matSet.add(m.uuid);
        if (m.transparent) hasTransparent = true;
      }
      obj.castShadow = !hasTransparent;
      obj.receiveShadow = true;

      if (!hasTransparent && tris > 0 && tris <= 10000) {
        const edges = new THREE.EdgesGeometry(geom, 28);
        const lines = new THREE.LineSegments(edges, edgeMaterial);
        lines.userData = { isCadEdge: true, nodeId, layerId: layerInfo.id };
        obj.add(lines);
      }
    }

    const childInfos: SceneNodeInfo[] = [];
    for (const child of obj.children) {
      if (child.userData?.isCadEdge) continue;
      if (child instanceof THREE.Camera || child instanceof THREE.Light) continue;
      const cInfo = walkObj(child, depth + 1, layerInfo.id);
      childInfos.push(cInfo);
      meshCount += cInfo.meshCount;
      triangleCount += cInfo.triangleCount;
    }

    obj.userData = {
      ...obj.userData,
      nodeId,
      layerId: layerInfo.id,
      ownVisible: obj.visible,
      isModelMesh: obj instanceof THREE.Mesh,
    };
    nodeMap.set(nodeId, obj);

    const displayName = isRoot
      ? fileName.replace(/\.[^.]+$/, '')
      : obj.name || (obj instanceof THREE.Mesh ? `Malla ${nodeCounter}` : `Grupo ${nodeCounter}`);

    return {
      id: nodeId,
      objectUuid: obj.uuid,
      name: displayName,
      type: isRoot ? 'root' : obj instanceof THREE.Mesh ? 'mesh' : 'group',
      layerId: layerInfo.id,
      visible: obj.visible,
      defaultVisible: obj.visible,
      meshCount,
      triangleCount,
      children: childInfos,
    };
  };

  const tree = walkObj(objectRoot, 0, '');

  // Center bottom-pivot at (0, 0, 0)
  contentRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(objectRoot);
  const size = new THREE.Vector3(1, 1, 1);
  const center = new THREE.Vector3(0, 0, 0);
  let centeringOffset: [number, number, number] = [0, 0, 0];

  if (!box.isEmpty()) {
    box.getSize(size);
    box.getCenter(center);
    centeringOffset = [-center.x, -box.min.y, -center.z];
    objectRoot.position.x += centeringOffset[0];
    objectRoot.position.y += centeringOffset[1];
    objectRoot.position.z += centeringOffset[2];
    contentRoot.updateMatrixWorld(true);
  }

  // Extract scenes from cameras & animation clips
  const scenes: ViewerScene[] = [];
  cameras.forEach((cam, idx) => {
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    cam.getWorldPosition(pos);
    cam.getWorldDirection(dir);
    const lookDist = Math.max(2, size.length() * 0.5);
    const target = pos.clone().addScaledVector(dir, lookDist);
    const fov = cam instanceof THREE.PerspectiveCamera ? cam.fov : 45;
    scenes.push({
      id: `cam-scene-${idx}`,
      name: cam.name || `Cámara ${idx + 1}`,
      description: 'Vista de cámara embebida',
      source: 'camera',
      camera: {
        position: [pos.x, pos.y, pos.z],
        target: [target.x, target.y, target.z],
        fov,
      },
      transitionSec: 1.8,
      delaySec: 1.5,
      includeInAnimation: true,
    });
  });

  animations.forEach((clip, idx) => {
    scenes.push({
      id: `anim-scene-${idx}`,
      name: clip.name || `Animación ${idx + 1}`,
      description: `Clip animado (${clip.duration.toFixed(1)}s)`,
      source: 'gltf-animation',
      animationClipName: clip.name || `clip_${idx}`,
      transitionSec: 1.0,
      delaySec: Math.max(2, clip.duration),
      includeInAnimation: true,
    });
  });

  const layers = Array.from(layerMap.values()).filter(
    (l) => l.entityCount > 0 || layerMap.size === 1,
  );

  return {
    id: modelId,
    name: fileName,
    format,
    fileSize,
    root: contentRoot,
    centeringOffset,
    rawSize: [Math.max(0.01, size.x), Math.max(0.01, size.y), Math.max(0.01, size.z)],
    layers,
    tree,
    scenes,
    animationClips: animations,
    stats: {
      meshes: totalMeshes,
      triangles: totalTriangles,
      vertices: totalVertices,
      materials: Math.max(1, matSet.size),
      layers: layers.length,
      scenes: scenes.length,
      dimensionsMeters: [
        Number(size.x.toFixed(2)),
        Number(size.y.toFixed(2)),
        Number(size.z.toFixed(2)),
      ],
    },
    nodeMap,
  };
}

export function createDemoPavilionScenes(): ViewerScene[] {
  return [
    {
      id: 'demo-scene-1',
      name: '1. Vista General',
      description: 'Perspectiva arquitectónica 3/4 del pabellón completo',
      source: 'skp-page',
      camera: {
        position: [9.5, 5.4, 9.8],
        target: [0, 1.6, 0.2],
        fov: 42,
      },
      hiddenLayerIds: [],
      transitionSec: 2.0,
      delaySec: 2.0,
      includeInAnimation: true,
    },
    {
      id: 'demo-scene-2',
      name: '2. Terraza y Pérgola',
      description: 'Acceso principal, espejo de agua y pérgola de cedro',
      source: 'skp-page',
      camera: {
        position: [3.2, 2.2, 8.2],
        target: [1.4, 1.5, -0.8],
        fov: 45,
      },
      hiddenLayerIds: [],
      transitionSec: 2.2,
      delaySec: 2.0,
      includeInAnimation: true,
    },
    {
      id: 'demo-scene-3',
      name: '3. Planta Abierta (Sin Cubierta)',
      description: 'Oculta la cubierta para inspeccionar distribución y mobiliario',
      source: 'skp-page',
      camera: {
        position: [0.4, 11.2, 5.6],
        target: [0, 1.0, 0],
        fov: 40,
      },
      hiddenLayerIds: ['Cubierta'],
      transitionSec: 2.0,
      delaySec: 2.2,
      includeInAnimation: true,
    },
    {
      id: 'demo-scene-4',
      name: '4. Esqueleto Estructural',
      description: 'Muestra solo terreno y estructura metálica principal',
      source: 'skp-page',
      camera: {
        position: [-8.4, 4.8, 7.6],
        target: [0, 1.8, 0],
        fov: 42,
      },
      hiddenLayerIds: ['Muros', 'Cubierta', 'Acristalamiento', 'Mobiliario', 'Vegetacion'],
      transitionSec: 2.0,
      delaySec: 2.2,
      includeInAnimation: true,
    },
    {
      id: 'demo-scene-5',
      name: '5. Comedor Interior',
      description: 'Vista cálida interior hacia la mesa de cedro y jardín',
      source: 'skp-page',
      camera: {
        position: [-0.4, 2.1, 4.6],
        target: [1.5, 1.2, -0.8],
        fov: 50,
      },
      hiddenLayerIds: [],
      transitionSec: 2.2,
      delaySec: 2.0,
      includeInAnimation: true,
    },
  ];
}

export async function loadModelFromBuffer(params: {
  buffer: ArrayBuffer;
  fileName: string;
  modelId: string;
  isDemo?: boolean;
  onProgress?: (pct: number, label: string) => void;
}): Promise<LoadedModel> {
  const { buffer, fileName, modelId, isDemo, onProgress } = params;
  const format = detectModelFormat(fileName);
  if (!format) {
    throw new Error(
      `Formato no soportado ("${fileName}"). Usa .skp, .glb, .gltf, .dae, .kmz o .obj.`,
    );
  }

  if (format === 'skp') {
    const model = await loadSkpFromBuffer(buffer, fileName, modelId, onProgress);
    if (isDemo) {
      model.isDemo = true;
      if (model.scenes.length === 0) {
        model.scenes = createDemoPavilionScenes();
        model.stats.scenes = model.scenes.length;
      }
    }
    return model;
  }

  if (format === 'glb' || format === 'gltf') {
    onProgress?.(30, 'Cargando glTF / GLB…');
    const loader = new GLTFLoader();
    const gltf = await new Promise<{
      scene: THREE.Group;
      animations: THREE.AnimationClip[];
      cameras: THREE.Camera[];
    }>((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    onProgress?.(90, 'Procesando nodos y animaciones…');
    const loaded = finalizeGenericObject({
      modelId,
      fileName,
      format,
      fileSize: buffer.byteLength,
      objectRoot: gltf.scene,
      animations: gltf.animations ?? [],
      cameras: gltf.cameras ?? [],
    });
    onProgress?.(100, 'Modelo listo');
    return loaded;
  }

  if (format === 'dae') {
    onProgress?.(30, 'Cargando Collada (.dae)…');
    const text = new TextDecoder().decode(buffer);
    const loader = new ColladaLoader();
    const collada = loader.parse(text, '');
    onProgress?.(90, 'Procesando jerarquía Collada…');
    const loaded = finalizeGenericObject({
      modelId,
      fileName,
      format,
      fileSize: buffer.byteLength,
      objectRoot: collada.scene,
      animations: (collada.scene as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [],
    });
    onProgress?.(100, 'Modelo listo');
    return loaded;
  }

  if (format === 'kmz') {
    onProgress?.(25, 'Descomprimiendo archivo KMZ de SketchUp…');
    const unzipped = unzipSync(new Uint8Array(buffer));
    const daeEntry = Object.keys(unzipped).find((k) => k.toLowerCase().endsWith('.dae'));
    if (!daeEntry) {
      throw new Error('El archivo KMZ no contiene ningún modelo Collada (.dae).');
    }

    const blobUrls = new Map<string, string>();
    for (const [entryPath, bytes] of Object.entries(unzipped)) {
      if (entryPath === daeEntry) continue;
      const safe = new Uint8Array(bytes.byteLength);
      safe.set(bytes);
      const url = URL.createObjectURL(new Blob([safe], { type: guessMimeFromName(entryPath) }));
      const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
      blobUrls.set(normalized, url);
      const base = normalized.split('/').pop();
      if (base) blobUrls.set(base, url);
    }

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((requestedUrl) => {
      const clean = requestedUrl.replace(/^\.\//, '').replace(/\\/g, '/').toLowerCase();
      const hit = blobUrls.get(clean) ?? blobUrls.get(clean.split('/').pop() ?? '');
      return hit ?? requestedUrl;
    });

    onProgress?.(60, 'Analizando escena Collada del KMZ…');
    const daeText = new TextDecoder().decode(unzipped[daeEntry]);
    const loader = new ColladaLoader(manager);
    const collada = loader.parse(daeText, '');
    const loaded = finalizeGenericObject({
      modelId,
      fileName,
      format,
      fileSize: buffer.byteLength,
      objectRoot: collada.scene,
      animations: (collada.scene as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [],
    });
    onProgress?.(100, 'Modelo KMZ listo');
    return loaded;
  }

  // Wavefront OBJ
  onProgress?.(40, 'Cargando Wavefront OBJ…');
  const text = new TextDecoder().decode(buffer);
  const loader = new OBJLoader();
  const objGroup = loader.parse(text);
  const defaultMat = new THREE.MeshStandardMaterial({
    color: 0xdbe4ee,
    roughness: 0.72,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  objGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.material) {
      child.material = defaultMat;
    }
  });
  const loaded = finalizeGenericObject({
    modelId,
    fileName,
    format: 'obj',
    fileSize: buffer.byteLength,
    objectRoot: objGroup,
    animations: [],
  });
  onProgress?.(100, 'Modelo OBJ listo');
  return loaded;
}
