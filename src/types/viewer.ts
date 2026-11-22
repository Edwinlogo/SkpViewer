import type * as THREE from 'three';

export type ModelFormat = 'skp' | 'glb' | 'gltf' | 'dae' | 'kmz' | 'obj';

export type BackgroundMode = 'studio' | 'dark' | 'passthrough' | 'camera';

export type TransformMode = 'none' | 'translate' | 'rotate' | 'scale';

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  defaultVisible: boolean;
  color: string;
  entityCount: number;
}

export interface SceneNodeInfo {
  id: string;
  objectUuid: string;
  name: string;
  definitionName?: string;
  type: 'root' | 'group' | 'component' | 'mesh';
  layerId: string;
  visible: boolean;
  defaultVisible: boolean;
  meshCount: number;
  triangleCount: number;
  properties?: Record<string, string>;
  children: SceneNodeInfo[];
}

export interface CameraSnapshot {
  /** Position in model-local meters (Y-up, relative to model pivot center/base). */
  position: [number, number, number];
  /** Target look-at point in model-local meters (Y-up). */
  target: [number, number, number];
  /** Up vector in Y-up. */
  up?: [number, number, number];
  /** Vertical field of view in degrees. */
  fov: number;
  /** Whether the SketchUp scene used parallel projection. */
  parallel?: boolean;
  /** Ortho view height in meters if parallel. */
  orthoHeight?: number;
}

export interface ViewerScene {
  id: string;
  name: string;
  description?: string;
  source: 'skp-page' | 'gltf-animation' | 'camera' | 'custom';
  camera?: CameraSnapshot;
  /** Layer IDs that should be hidden when this scene is active. */
  hiddenLayerIds?: string[];
  /** Node IDs that should be hidden when this scene is active. */
  hiddenNodeIds?: string[];
  /** Optional glTF/Collada AnimationClip name linked to this scene. */
  animationClipName?: string;
  /** Transition time in seconds when animating into this scene. */
  transitionSec: number;
  /** Hold delay in seconds during continuous scene playback. */
  delaySec: number;
  /** Whether to include this scene when playing all scenes. */
  includeInAnimation: boolean;
}

export interface ModelTransform {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: number;
}

export interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
  materials: number;
  layers: number;
  scenes: number;
  dimensionsMeters: [number, number, number];
  sketchupVersion?: string;
  units?: string;
}

export interface LoadedModel {
  id: string;
  name: string;
  format: ModelFormat;
  fileSize: number;
  isDemo?: boolean;
  root: THREE.Group;
  /** Offset applied to shift model raw coordinates to centered bottom-pivot (0, 0, 0). */
  centeringOffset: [number, number, number];
  /** Raw bounding box size in meters before user scale. */
  rawSize: [number, number, number];
  layers: LayerInfo[];
  tree: SceneNodeInfo;
  scenes: ViewerScene[];
  animationClips: THREE.AnimationClip[];
  stats: ModelStats;
  thumbnailDataUrl?: string;
  /** Map from nodeId -> Object3D for fast visibility toggling & highlighting. */
  nodeMap: Map<string, THREE.Object3D>;
}

export interface SavedModelRecord {
  id: string;
  name: string;
  format: ModelFormat;
  size: number;
  savedAt: number;
  thumbnailDataUrl?: string;
  customScenes?: ViewerScene[];
  data: ArrayBuffer;
}

export interface SavedModelMeta {
  id: string;
  name: string;
  format: ModelFormat;
  size: number;
  savedAt: number;
  thumbnailDataUrl?: string;
}

export interface XRStatus {
  webXRAvailable: boolean;
  arSupported: boolean;
  vrSupported: boolean;
  activeMode: 'none' | 'immersive-ar' | 'immersive-vr';
  domOverlayActive: boolean;
  handTrackingActive: boolean;
  hitTestAvailable: boolean;
  placementActive: boolean;
}

export interface AnimationPlaybackState {
  isPlaying: boolean;
  activeSceneId: string | null;
  activeClipName: string | null;
  clipTime: number;
  clipDuration: number;
  clipLoop: boolean;
  speed: number;
  transitionProgress: number;
  sceneLoop: boolean;
}
