import * as THREE from 'three';
import {
  buildInstancedScene,
  extractThumbnail,
  parseSkp,
  type InstancedMeshResource,
  type InstancedNode,
  type InstancedScene,
  type Page,
  type SceneTexture,
} from 'openskp';
import type {
  LayerInfo,
  LoadedModel,
  SceneNodeInfo,
  ViewerScene,
} from '../types/viewer';

const INCH_TO_METER = 0.0254;

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

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function uint8ToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function decodeSceneTextures(sceneTextures: SceneTexture[]): Promise<Array<THREE.Texture | null>> {
  const results = await Promise.all(
    sceneTextures.map(async (st) => {
      try {
        const safeBytes = new Uint8Array(st.data.byteLength);
        safeBytes.set(st.data);
        const blob = new Blob([safeBytes], { type: st.mimeType });
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(blob);
          const tex = new THREE.Texture(bitmap);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.flipY = false;
          tex.needsUpdate = true;
          return tex;
        }
        const url = URL.createObjectURL(blob);
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => {
            URL.revokeObjectURL(url);
            resolve(el);
          };
          el.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
          };
          el.src = url;
        });
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        tex.needsUpdate = true;
        return tex;
      } catch {
        return null;
      }
    }),
  );
  return results;
}

interface GltfMatLike {
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  doubleSided?: boolean;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
}

function buildThreeMaterials(
  gltfMaterials: unknown[],
  decodedTextures: Array<THREE.Texture | null>,
): THREE.MeshStandardMaterial[] {
  if (!gltfMaterials.length) {
    return [
      new THREE.MeshStandardMaterial({
        color: 0xdbe4ee,
        roughness: 0.78,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    ];
  }

  return gltfMaterials.map((raw) => {
    const m = (raw ?? {}) as GltfMatLike;
    const pbr = m.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [0.85, 0.85, 0.85, 1];
    const texIdx = pbr.baseColorTexture?.index;
    const map = texIdx !== undefined && texIdx >= 0 ? (decodedTextures[texIdx] ?? null) : null;

    const alpha = factor[3] ?? 1;
    const isBlend = m.alphaMode === 'BLEND' || alpha < 0.99;
    const isMask = !isBlend && m.alphaMode === 'MASK' && map !== null;

    // When a texture is bound, SketchUp stores its average color in baseColorFactor;
    // using white prevents double-darkening the photo texture.
    const color = map
      ? new THREE.Color(0xffffff)
      : new THREE.Color().setRGB(factor[0], factor[1], factor[2], THREE.SRGBColorSpace);

    const isGlassLike = isBlend && alpha < 0.65;
    const mat = new THREE.MeshStandardMaterial({
      color,
      map,
      roughness: isGlassLike ? 0.12 : (pbr.roughnessFactor ?? 0.76),
      metalness: isGlassLike ? 0.1 : (pbr.metallicFactor ?? 0.04),
      transparent: isBlend,
      opacity: isBlend ? Math.max(0.08, alpha) : 1,
      alphaTest: isMask ? 0.4 : 0,
      depthWrite: !isBlend,
      side: m.doubleSided || isBlend ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    return mat;
  });
}

function buildResourceGeometries(resources: InstancedMeshResource[]): Map<
  string,
  Array<{
    geometry: THREE.BufferGeometry;
    edgeGeometry: THREE.EdgesGeometry | null;
    materialIndex: number;
    triangles: number;
    vertices: number;
  }>
> {
  const map = new Map<
    string,
    Array<{
      geometry: THREE.BufferGeometry;
      edgeGeometry: THREE.EdgesGeometry | null;
      materialIndex: number;
      triangles: number;
      vertices: number;
    }>
  >();

  for (const res of resources) {
    const prims = res.primitives.map((prim) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(prim.positions, 3));
      if (prim.normals && prim.normals.length === prim.positions.length) {
        geom.setAttribute('normal', new THREE.BufferAttribute(prim.normals, 3));
      } else {
        geom.computeVertexNormals();
      }
      if (prim.uvs && prim.uvs.length > 0) {
        geom.setAttribute('uv', new THREE.BufferAttribute(prim.uvs, 2));
      }
      geom.setIndex(new THREE.BufferAttribute(prim.indices, 1));
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const triangles = Math.floor(prim.indices.length / 3);
      // Avoid expensive crease-edge generation on ultra-dense organic sub-meshes
      const edgeGeometry = triangles <= 12000 ? new THREE.EdgesGeometry(geom, 28) : null;

      return {
        geometry: geom,
        edgeGeometry,
        materialIndex: prim.materialIndex,
        triangles,
        vertices: Math.floor(prim.positions.length / 3),
      };
    });
    map.set(res.id, prims);
  }
  return map;
}

function skpInchesZUpToMetersYUp(
  pt: [number, number, number],
  centeringOffset: [number, number, number],
): [number, number, number] {
  const mx = pt[0] * INCH_TO_METER + centeringOffset[0];
  const my = pt[2] * INCH_TO_METER + centeringOffset[1];
  const mz = -pt[1] * INCH_TO_METER + centeringOffset[2];
  return [mx, my, mz];
}

function skpDirZUpToYUp(v: [number, number, number]): [number, number, number] {
  const vec = new THREE.Vector3(v[0], v[2], -v[1]);
  if (vec.lengthSq() > 1e-8) vec.normalize();
  else vec.set(0, 1, 0);
  return [vec.x, vec.y, vec.z];
}

function normalizeLayerKey(rawLayer: string | undefined): string {
  const trimmed = (rawLayer ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Layer0';
}

export async function loadSkpFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  modelId: string,
  onProgress?: (pct: number, label: string) => void,
): Promise<LoadedModel> {
  onProgress?.(10, 'Analizando cabecera y metadatos SKP…');
  const parsed = parseSkp(buffer, {
    onProgress: (info) => {
      if (info.total > 0) {
        const pct = 10 + Math.round((info.current / info.total) * 30);
        onProgress?.(Math.min(40, pct), `Leyendo SKP (${info.stage})…`);
      }
    },
  });

  onProgress?.(45, 'Triangulando geometría e instancias SketchUp…');
  const instanced: InstancedScene = buildInstancedScene(buffer, {
    onProgress: (info) => {
      if (info.total > 0) {
        const pct = 45 + Math.round((info.current / info.total) * 35);
        onProgress?.(Math.min(80, pct), `Construyendo geometría (${info.stage})…`);
      }
    },
  });

  let thumbnailDataUrl: string | undefined;
  try {
    const thumb = extractThumbnail(buffer);
    if (thumb && thumb.data.length > 0) {
      thumbnailDataUrl = uint8ToDataUrl(thumb.data, thumb.mimeType);
    }
  } catch {
    // Thumbnail is optional
  }

  onProgress?.(84, 'Decodificando materiales y texturas…');
  const decodedTextures = await decodeSceneTextures(instanced.textures);
  const materials = buildThreeMaterials(instanced.gltfMaterials, decodedTextures);
  const resourceGeoms = buildResourceGeometries(instanced.meshResources);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  // Collect layers from both parsed.layers and instanced.layerColors
  const layerMap = new Map<string, LayerInfo>();
  const ensureLayer = (rawName: string): LayerInfo => {
    const name = normalizeLayerKey(rawName);
    const existing = layerMap.get(name);
    if (existing) return existing;

    const paletteColor = LAYER_PALETTE[layerMap.size % LAYER_PALETTE.length];
    const colorRgb = instanced.layerColors?.[name];
    const parsedLayer = parsed.layers.find((l) => l.name === name);
    const color = colorRgb
      ? rgbToHex(colorRgb[0], colorRgb[1], colorRgb[2])
      : parsedLayer
        ? rgbToHex(parsedLayer.color.r, parsedLayer.color.g, parsedLayer.color.b)
        : paletteColor;
    const isHidden = Boolean(instanced.layerHidden?.[name] ?? parsedLayer?.hidden ?? false);

    const info: LayerInfo = {
      id: name,
      name: name === 'Layer0' ? 'Sin etiqueta (Layer0)' : name,
      visible: !isHidden,
      defaultVisible: !isHidden,
      color,
      entityCount: 0,
    };
    layerMap.set(name, info);
    return info;
  };

  for (const l of parsed.layers) {
    ensureLayer(l.name);
  }
  if (instanced.layerColors) {
    for (const lname of Object.keys(instanced.layerColors)) {
      ensureLayer(lname);
    }
  }

  onProgress?.(92, 'Armando jerarquía de componentes y capas…');
  const contentRoot = new THREE.Group();
  contentRoot.name = fileName;

  const nodeMap = new Map<string, THREE.Object3D>();
  let nodeCounter = 0;
  let totalMeshes = 0;
  let totalTriangles = 0;
  let totalVertices = 0;

  const walkInstancedNode = (src: InstancedNode, isRoot: boolean): { group: THREE.Group; info: SceneNodeInfo } => {
    const nodeId = isRoot ? 'node-root' : `node-${++nodeCounter}`;
    const group = new THREE.Group();
    const displayName = isRoot
      ? fileName.replace(/\.skp$/i, '')
      : src.name && !src.nameIsGenerated
        ? src.name
        : src.definitionName && src.definitionName !== 'ROOT'
          ? src.definitionName
          : src.name || `Elemento ${nodeCounter}`;

    group.name = displayName;

    if (!isRoot && src.matrix && src.matrix.length === 16) {
      const m4 = new THREE.Matrix4().fromArray(src.matrix);
      group.applyMatrix4(m4);
    }

    const layerKey = normalizeLayerKey(src.layer);
    const layerInfo = ensureLayer(layerKey);
    const ownVisible = !(src.hidden ?? false);

    let meshCount = 0;
    let triangleCount = 0;

    if (src.meshResourceId) {
      const prims = resourceGeoms.get(src.meshResourceId) ?? [];
      for (const p of prims) {
        const mat = materials[p.materialIndex] ?? materials[0];
        const mesh = new THREE.Mesh(p.geometry, mat);
        mesh.name = `${displayName}_mesh_${meshCount + 1}`;
        mesh.castShadow = !mat.transparent;
        mesh.receiveShadow = true;
        mesh.userData = {
          nodeId,
          layerId: layerInfo.id,
          isModelMesh: true,
        };
        if (p.edgeGeometry && !mat.transparent) {
          const lines = new THREE.LineSegments(p.edgeGeometry, edgeMaterial);
          lines.userData = { isCadEdge: true, nodeId, layerId: layerInfo.id };
          lines.renderOrder = 2;
          mesh.add(lines);
        }
        group.add(mesh);
        meshCount += 1;
        triangleCount += p.triangles;
        totalMeshes += 1;
        totalTriangles += p.triangles;
        totalVertices += p.vertices;
      }
      if (!isRoot) {
        layerInfo.entityCount += 1;
      }
    }

    const childInfos: SceneNodeInfo[] = [];
    for (const child of src.children) {
      const built = walkInstancedNode(child, false);
      group.add(built.group);
      childInfos.push(built.info);
      meshCount += built.info.meshCount;
      triangleCount += built.info.triangleCount;
    }

    const mergedProps: Record<string, string> = { ...src.properties };
    if (src.attributeDictionaries) {
      for (const [dictName, dict] of Object.entries(src.attributeDictionaries)) {
        for (const [k, v] of Object.entries(dict)) {
          if (v && !mergedProps[`${dictName}.${k}`]) {
            mergedProps[`${dictName}.${k}`] = v;
          }
        }
      }
    }

    group.userData = {
      nodeId,
      layerId: layerInfo.id,
      ownVisible,
      definitionName: src.definitionName,
      properties: mergedProps,
    };
    nodeMap.set(nodeId, group);

    const nodeType: SceneNodeInfo['type'] = isRoot
      ? 'root'
      : childInfos.length > 0
        ? 'group'
        : src.definitionName && src.definitionName !== 'ROOT'
          ? 'component'
          : 'mesh';

    return {
      group,
      info: {
        id: nodeId,
        objectUuid: group.uuid,
        name: displayName,
        definitionName: src.definitionName !== 'ROOT' ? src.definitionName : undefined,
        type: nodeType,
        layerId: layerInfo.id,
        visible: ownVisible,
        defaultVisible: ownVisible,
        meshCount,
        triangleCount,
        properties: Object.keys(mergedProps).length > 0 ? mergedProps : undefined,
        children: childInfos,
      },
    };
  };

  const builtRoot = walkInstancedNode(instanced.sceneHierarchy, true);
  contentRoot.add(builtRoot.group);

  // Compute world bounds and shift so model bottom-center rests at (0, 0, 0)
  contentRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(builtRoot.group);
  const size = new THREE.Vector3(1, 1, 1);
  const center = new THREE.Vector3(0, 0, 0);
  let centeringOffset: [number, number, number] = [0, 0, 0];

  if (!box.isEmpty()) {
    box.getSize(size);
    box.getCenter(center);
    centeringOffset = [-center.x, -box.min.y, -center.z];
    builtRoot.group.position.set(centeringOffset[0], centeringOffset[1], centeringOffset[2]);
    contentRoot.updateMatrixWorld(true);
  }

  // Convert SketchUp Pages (Scenes) into ViewerScenes!
  const scenes: ViewerScene[] = parsed.pages.map((page: Page, idx: number) => {
    const hiddenLayerIds = (page.hiddenLayers ?? [])
      .map((name) => normalizeLayerKey(name))
      .filter((id) => layerMap.has(id));

    const hasCamera = Boolean(page.eye && page.target);
    return {
      id: `skp-page-${idx}`,
      name: page.name || `Escena ${idx + 1}`,
      description: page.parallel ? 'Proyección paralela (SketchUp)' : `Cámara FOV ${Math.round(page.fov || 35)}°`,
      source: 'skp-page',
      camera: hasCamera
        ? {
            position: skpInchesZUpToMetersYUp(page.eye!, centeringOffset),
            target: skpInchesZUpToMetersYUp(page.target!, centeringOffset),
            up: page.up ? skpDirZUpToYUp(page.up) : [0, 1, 0],
            fov: page.fov && page.fov > 5 && page.fov < 140 ? page.fov : 40,
            parallel: page.parallel,
            orthoHeight: page.orthoHeight ? page.orthoHeight * INCH_TO_METER : undefined,
          }
        : undefined,
      hiddenLayerIds,
      transitionSec: 2.0,
      delaySec: 1.5,
      includeInAnimation: true,
    };
  });

  // Sort layers: put Layer0 first, then alphabetical
  const layers = Array.from(layerMap.values()).sort((a, b) => {
    if (a.id === 'Layer0') return -1;
    if (b.id === 'Layer0') return 1;
    return a.name.localeCompare(b.name, 'es');
  });

  onProgress?.(100, 'Modelo SKP listo');

  return {
    id: modelId,
    name: fileName,
    format: 'skp',
    fileSize: buffer.byteLength,
    root: contentRoot,
    centeringOffset,
    rawSize: [
      Math.max(0.01, size.x),
      Math.max(0.01, size.y),
      Math.max(0.01, size.z),
    ],
    layers,
    tree: builtRoot.info,
    scenes,
    animationClips: [],
    stats: {
      meshes: totalMeshes,
      triangles: totalTriangles,
      vertices: totalVertices,
      materials: materials.length,
      layers: layers.length,
      scenes: scenes.length,
      dimensionsMeters: [
        Number(size.x.toFixed(2)),
        Number(size.y.toFixed(2)),
        Number(size.z.toFixed(2)),
      ],
      sketchupVersion: parsed.version ? parsed.version.replace(/[{}]/g, '') : undefined,
      units: parsed.units ?? 'Pulgadas (convertido a metros)',
    },
    thumbnailDataUrl,
    nodeMap,
  };
}
