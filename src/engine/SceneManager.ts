import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import type {
  AnimationPlaybackState,
  BackgroundMode,
  CameraSnapshot,
  LayerInfo,
  LoadedModel,
  ModelTransform,
  TransformMode,
  ViewerScene,
  XRStatus,
} from '../types/viewer';
import { XRSpatialPanel, type SpatialPanelAction } from './XRSpatialPanel';

export interface SceneManagerCallbacks {
  onTransformChange: (transform: ModelTransform) => void;
  onSelectionChange: (nodeId: string | null) => void;
  onXRStatusChange: (status: XRStatus) => void;
  onPlaybackChange: (state: AnimationPlaybackState) => void;
  onLayersChanged: (layers: LayerInfo[]) => void;
  onBackgroundChange: (mode: BackgroundMode) => void;
  onEdgesChange?: (visible: boolean) => void;
  onToast?: (message: string) => void;
}

interface CameraTransition {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startFov: number;
  endFov: number;
  elapsed: number;
  duration: number;
}

interface XRGrabberState {
  controller: THREE.Group;
  ray: THREE.Line;
  grabbing: boolean;
  pinching: boolean;
  startMatrixInv: THREE.Matrix4;
  pivotStartMatrix: THREE.Matrix4;
  inputSource: XRInputSource | null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class SceneManager {
  private container: HTMLElement;
  private callbacks: SceneManagerCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;
  private transformHelper: THREE.Object3D;

  // Lighting & environment backdrop
  private pmremGenerator: THREE.PMREMGenerator;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private envGroup: THREE.Group;
  private gridHelper: THREE.GridHelper;
  private studioFloor: THREE.Mesh;
  private shadowCatcherFloor: THREE.Mesh;
  private skyDome: THREE.Mesh;

  // Model & selection
  private modelPivot: THREE.Group;
  private currentModel: LoadedModel | null = null;
  private selectionBox: THREE.BoxHelper | null = null;
  private selectedNodeId: string | null = null;
  private baseFitScale = 1;

  // Visibility state (kept orthogonal!)
  private layerVisibility = new Map<string, boolean>();
  private nodeVisibility = new Map<string, boolean>();
  private showCadEdges = true;
  private xrayMode = false;
  private savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private xrayMaterial: THREE.MeshPhysicalMaterial;

  // Background & Camera Passthrough
  private backgroundMode: BackgroundMode = 'studio';
  private transformMode: TransformMode = 'none';

  // Scenes & Animations
  private scenes: ViewerScene[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private activeAction: THREE.AnimationAction | null = null;
  private activeTransition: CameraTransition | null = null;
  private sceneHoldTimer = 0;
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

  // WebXR state
  private xrStatus: XRStatus = {
    webXRAvailable: false,
    arSupported: false,
    vrSupported: false,
    activeMode: 'none',
    domOverlayActive: false,
    handTrackingActive: false,
    hitTestAvailable: false,
    placementActive: false,
  };
  private xrRig: THREE.Group;
  private xrSession: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private hitTestRequested = false;
  private reticle: THREE.Mesh;
  private grabbers: XRGrabberState[] = [];
  private xrHands: THREE.XRHandSpace[] = [];
  private twoHandStartDist = 0;
  private twoHandStartScale = 1;
  private twoHandStartAngle = 0;
  private twoHandStartRotY = 0;
  private twoHandStartMid = new THREE.Vector3();
  private twoHandPivotStartPos = new THREE.Vector3();
  private twoHandActive = false;
  private spatialPanel: XRSpatialPanel;
  private buttonLatch = new Map<string, boolean>();

  // Pointer picking
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = new THREE.Vector2();
  private clock = new THREE.Clock();
  private lastUiSync = 0;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: SceneManagerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.02, 400);
    this.camera.position.set(8, 5, 9);

    this.xrRig = new THREE.Group();
    this.xrRig.name = 'XRRig';
    this.xrRig.add(this.camera);
    this.scene.add(this.xrRig);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.setClearColor(0x000000, 0);

    container.appendChild(this.renderer.domElement);

    // Offline procedural IBL lighting (RoomEnvironment — zero external network requests!)
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.65;

    // Studio & Sunlight rig
    const hemiLight = new THREE.HemisphereLight(0xf0f7ff, 0x334155, 0.95);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffaf0, 1.85);
    sunLight.position.set(12, 18, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 65;
    sunLight.shadow.camera.left = -16;
    sunLight.shadow.camera.right = 16;
    sunLight.shadow.camera.top = 16;
    sunLight.shadow.camera.bottom = -16;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.025;
    this.scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
    fillLight.position.set(-10, 8, -12);
    this.scene.add(fillLight);

    // Virtual Environment group (hidden in Passthrough mode!)
    this.envGroup = new THREE.Group();
    this.envGroup.name = 'VirtualEnvironment';

    // Sky dome (works in WebXR VR & Studio mode, hidden in Passthrough)
    const skyGeom = new THREE.SphereGeometry(120, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color('#c7ddf5') },
        horizonColor: { value: new THREE.Color('#eef4fa') },
        bottomColor: { value: new THREE.Color('#cbd5e1') },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 col = h >= 0.0
            ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(horizonColor, bottomColor, pow(clamp(-h, 0.0, 1.0), 0.4));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeom, skyMat);
    this.envGroup.add(this.skyDome);

    // Subtle studio floor
    const floorGeom = new THREE.CircleGeometry(45, 64);
    floorGeom.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.92,
      metalness: 0.0,
      transparent: true,
      opacity: 0.65,
    });
    this.studioFloor = new THREE.Mesh(floorGeom, floorMat);
    this.studioFloor.position.y = -0.004;
    this.studioFloor.receiveShadow = true;
    this.envGroup.add(this.studioFloor);

    // Architectural grid
    this.gridHelper = new THREE.GridHelper(32, 32, 0x64748b, 0x94a3b8);
    this.gridHelper.position.y = -0.002;
    const gridMats = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material
      : [this.gridHelper.material];
    gridMats.forEach((gm) => {
      gm.transparent = true;
      gm.opacity = 0.28;
    });
    this.envGroup.add(this.gridHelper);
    this.scene.add(this.envGroup);

    // Invisible shadow-catcher floor (stays active in Passthrough AR so models ground visually!)
    const scGeom = new THREE.PlaneGeometry(40, 40);
    scGeom.rotateX(-Math.PI / 2);
    const scMat = new THREE.ShadowMaterial({ opacity: 0.24 });
    this.shadowCatcherFloor = new THREE.Mesh(scGeom, scMat);
    this.shadowCatcherFloor.position.y = -0.001;
    this.shadowCatcherFloor.receiveShadow = true;
    this.scene.add(this.shadowCatcherFloor);

    // Model Pivot
    this.modelPivot = new THREE.Group();
    this.modelPivot.name = 'ModelPivot';
    this.scene.add(this.modelPivot);

    // X-Ray inspection material
    this.xrayMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.26,
      roughness: 0.25,
      metalness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // OrbitControls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.maxDistance = 140;
    this.orbitControls.minDistance = 0.15;
    this.orbitControls.target.set(0, 1.5, 0);

    // TransformControls (Move / Rotate / Scale gizmo)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(0.85);
    this.transformControls.addEventListener('dragging-changed', (ev) => {
      this.orbitControls.enabled = !ev.value;
    });
    this.transformControls.addEventListener('objectChange', () => {
      this.enforceUniformScale();
      this.emitTransform();
    });
    this.transformHelper = this.transformControls.getHelper();
    this.transformHelper.visible = false;
    this.scene.add(this.transformHelper);

    // AR Hit-Test Reticle
    const reticleGeom = new THREE.RingGeometry(0.11, 0.15, 36).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.reticle = new THREE.Mesh(reticleGeom, reticleMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    const innerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide }),
    );
    this.reticle.add(innerDot);
    this.scene.add(this.reticle);

    // XR Spatial Panel (3D HUD inside WebXR headsets)
    this.spatialPanel = new XRSpatialPanel((action) => this.handleSpatialPanelAction(action));
    this.scene.add(this.spatialPanel.group);

    this.setupXRControllers();
    this.setBackgroundMode('studio');

    // Events
    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);

    void this.detectWebXRCapabilities();
    this.renderer.setAnimationLoop(this.animate);
  }

  private setupXRControllers(): void {
    const controllerFactory = new XRControllerModelFactory();
    const handFactory = new XRHandModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      const rayGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -4.5),
      ]);
      const rayMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
      });
      const ray = new THREE.Line(rayGeom, rayMat);
      ray.name = `XRRay_${i}`;
      controller.add(ray);
      this.xrRig.add(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllerFactory.createControllerModel(grip));
      this.xrRig.add(grip);

      const hand = this.renderer.xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, 'mesh'));
      this.xrRig.add(hand);
      this.xrHands.push(hand);

      const state: XRGrabberState = {
        controller,
        ray,
        grabbing: false,
        pinching: false,
        startMatrixInv: new THREE.Matrix4(),
        pivotStartMatrix: new THREE.Matrix4(),
        inputSource: null,
      };
      this.grabbers.push(state);

      controller.addEventListener('connected', (ev: { data?: XRInputSource }) => {
        state.inputSource = ev.data ?? null;
        if (ev.data?.hand) {
          this.xrStatus.handTrackingActive = true;
          this.callbacks.onXRStatusChange({ ...this.xrStatus });
        }
      });

      controller.addEventListener('disconnected', () => {
        state.inputSource = null;
        state.grabbing = false;
        this.twoHandActive = false;
      });

      controller.addEventListener('selectstart', () => this.onXRSelectStart(i));
      controller.addEventListener('selectend', () => this.onXRSelectEnd(i));
      controller.addEventListener('squeezestart', () => this.beginGrab(i));
      controller.addEventListener('squeezeend', () => this.endGrab(i));
    }
  }

  public async detectWebXRCapabilities(): Promise<XRStatus> {
    const xr = navigator.xr;
    if (!xr) {
      this.xrStatus = { ...this.xrStatus, webXRAvailable: false, arSupported: false, vrSupported: false };
      this.callbacks.onXRStatusChange({ ...this.xrStatus });
      return this.xrStatus;
    }

    let arSupported = false;
    let vrSupported = false;
    try {
      arSupported = await xr.isSessionSupported('immersive-ar');
    } catch {
      arSupported = false;
    }
    try {
      vrSupported = await xr.isSessionSupported('immersive-vr');
    } catch {
      vrSupported = false;
    }

    this.xrStatus = {
      ...this.xrStatus,
      webXRAvailable: true,
      arSupported,
      vrSupported,
    };
    this.callbacks.onXRStatusChange({ ...this.xrStatus });
    return this.xrStatus;
  }

  public async enterXR(mode: 'immersive-ar' | 'immersive-vr', overlayRoot?: HTMLElement | null): Promise<void> {
    const xr = navigator.xr;
    if (!xr) {
      throw new Error('WebXR no está disponible en este navegador.');
    }
    if (this.xrSession) {
      await this.xrSession.end();
    }

    const optionalFeatures: string[] = ['local-floor', 'bounded-floor', 'hand-tracking'];
    if (mode === 'immersive-ar') {
      optionalFeatures.push('hit-test');
      if (overlayRoot) optionalFeatures.push('dom-overlay');
    }

    const init: XRSessionInit = { optionalFeatures };
    if (mode === 'immersive-ar' && overlayRoot) {
      (init as XRSessionInit & { domOverlay?: { root: HTMLElement } }).domOverlay = {
        root: overlayRoot,
      };
    }

    const session = await xr.requestSession(mode, init);
    this.xrSession = session;
    this.hitTestRequested = false;
    this.hitTestSource = null;

    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    const domOverlayState = (session as XRSession & { domOverlayState?: { type?: string } }).domOverlayState;
    const domOverlayActive = Boolean(domOverlayState?.type);

    this.xrStatus = {
      ...this.xrStatus,
      activeMode: mode,
      domOverlayActive,
      placementActive: mode === 'immersive-ar',
    };

    // Hide 2D Transform gizmo in XR
    this.transformControls.detach();
    this.transformHelper.visible = false;

    // Auto-enable transparent Passthrough in AR mode!
    if (mode === 'immersive-ar') {
      this.setBackgroundMode('passthrough');
      // Place model at comfortable tabletop scale in front of viewer
      this.positionModelForXR(1.25);
    } else {
      this.positionModelForXR(2.2);
    }

    // Show 3D Spatial HUD panel for headsets (when DOM overlay isn't covering the screen)
    if (!domOverlayActive) {
      this.spatialPanel.group.visible = true;
      setTimeout(() => {
        if (this.xrSession) {
          this.spatialPanel.placeInFrontOfCamera(this.renderer.xr.getCamera());
        }
      }, 250);
    } else {
      this.spatialPanel.group.visible = false;
    }

    this.syncSpatialPanel();
    this.callbacks.onXRStatusChange({ ...this.xrStatus });

    session.addEventListener('end', () => {
      this.xrSession = null;
      this.hitTestSource = null;
      this.hitTestRequested = false;
      this.reticle.visible = false;
      this.spatialPanel.group.visible = false;
      this.twoHandActive = false;
      this.grabbers.forEach((g) => (g.grabbing = false));
      this.xrStatus = {
        ...this.xrStatus,
        activeMode: 'none',
        domOverlayActive: false,
        hitTestAvailable: false,
        placementActive: false,
      };
      // Restore desktop TransformControls if active
      if (this.transformMode !== 'none' && this.currentModel) {
        this.transformControls.attach(this.modelPivot);
        this.transformHelper.visible = true;
      }
      this.callbacks.onXRStatusChange({ ...this.xrStatus });
    });
  }

  public async exitXR(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end();
    }
  }

  public toggleSpatialPanel(): void {
    if (!this.xrSession) return;
    this.spatialPanel.group.visible = !this.spatialPanel.group.visible;
    if (this.spatialPanel.group.visible) {
      this.spatialPanel.placeInFrontOfCamera(this.renderer.xr.getCamera());
      this.syncSpatialPanel();
    }
  }

  public setARPlacementMode(active: boolean): void {
    this.xrStatus.placementActive = active;
    if (!active) this.reticle.visible = false;
    this.callbacks.onXRStatusChange({ ...this.xrStatus });
  }

  private positionModelForXR(targetMaxSize: number): void {
    if (!this.currentModel) return;
    const maxDim = Math.max(...this.currentModel.rawSize);
    const scale = maxDim > 0.01 ? Math.min(1, targetMaxSize / maxDim) : 1;
    this.modelPivot.scale.setScalar(scale);
    this.modelPivot.position.set(0, 0.72, -1.65);
    this.modelPivot.rotation.set(0, 0, 0);
    this.emitTransform();
  }

  private onXRSelectStart(index: number): void {
    const grabber = this.grabbers[index];
    if (!grabber) return;

    // 1. Check click on Spatial 3D Panel first
    if (this.spatialPanel.group.visible) {
      const hit = this.raycastFromController(grabber.controller, [this.spatialPanel.mesh]);
      if (hit && hit.uv) {
        if (this.spatialPanel.handleRayClick(hit.uv)) return;
      }
    }

    // 2. If AR hit-test reticle is active & visible, place model onto detected surface!
    if (this.xrStatus.activeMode === 'immersive-ar' && this.xrStatus.placementActive && this.reticle.visible) {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      this.reticle.matrix.decompose(pos, quat, scl);
      this.modelPivot.position.copy(pos);
      this.xrStatus.placementActive = false;
      this.reticle.visible = false;
      this.callbacks.onXRStatusChange({ ...this.xrStatus });
      this.callbacks.onToast?.('Modelo ubicado sobre la superficie real');
      this.emitTransform();
      return;
    }

    // 3. Otherwise allow select-grabbing the model (super ergonomic for mobile & hand pinch!)
    this.beginGrab(index);
  }

  private onXRSelectEnd(index: number): void {
    this.endGrab(index);
  }

  private beginGrab(index: number): void {
    const g = this.grabbers[index];
    if (!g || !this.currentModel) return;
    g.grabbing = true;
    g.controller.updateMatrixWorld(true);
    g.startMatrixInv.copy(g.controller.matrixWorld).invert();
    this.modelPivot.updateMatrixWorld(true);
    g.pivotStartMatrix.copy(this.modelPivot.matrixWorld);

    // Check if BOTH hands/controllers are now grabbing -> 2-hand scale & rotate!
    if (this.grabbers[0].grabbing && this.grabbers[1].grabbing) {
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      this.grabbers[0].controller.getWorldPosition(p0);
      this.grabbers[1].controller.getWorldPosition(p1);
      this.twoHandStartDist = Math.max(0.05, p0.distanceTo(p1));
      this.twoHandStartScale = this.modelPivot.scale.x;
      this.twoHandStartAngle = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      this.twoHandStartRotY = this.modelPivot.rotation.y;
      this.twoHandStartMid.addVectors(p0, p1).multiplyScalar(0.5);
      this.twoHandPivotStartPos.copy(this.modelPivot.position);
      this.twoHandActive = true;
    }
  }

  private endGrab(index: number): void {
    const g = this.grabbers[index];
    if (!g) return;
    g.grabbing = false;
    this.twoHandActive = false;
    // Re-anchor remaining single grabber smoothly if still held
    const other = this.grabbers[index === 0 ? 1 : 0];
    if (other?.grabbing) {
      other.controller.updateMatrixWorld(true);
      other.startMatrixInv.copy(other.controller.matrixWorld).invert();
      this.modelPivot.updateMatrixWorld(true);
      other.pivotStartMatrix.copy(this.modelPivot.matrixWorld);
    }
    this.emitTransform();
  }

  private raycastFromController(controller: THREE.Group, targets: THREE.Object3D[]): THREE.Intersection | null {
    const tempMatrix = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const hits = this.raycaster.intersectObjects(targets, true);
    return hits.length > 0 ? hits[0] : null;
  }

  private handleSpatialPanelAction(action: SpatialPanelAction): void {
    switch (action.type) {
      case 'toggle-passthrough':
        this.setBackgroundMode(this.backgroundMode === 'passthrough' ? 'studio' : 'passthrough');
        break;
      case 'set-scale-preset':
        this.applyScalePreset(action.preset);
        break;
      case 'rotate-yaw':
        this.modelPivot.rotation.y += THREE.MathUtils.degToRad(action.deltaDeg);
        this.emitTransform();
        break;
      case 'move-y':
        this.modelPivot.position.y += action.deltaMeters;
        this.emitTransform();
        break;
      case 'snap-floor':
        this.snapToFloor();
        break;
      case 'reset-transform':
        if (this.xrSession) this.positionModelForXR(1.25);
        else this.resetTransform();
        break;
      case 'toggle-layer': {
        const cur = this.layerVisibility.get(action.layerId) ?? true;
        this.setLayerVisible(action.layerId, !cur);
        break;
      }
      case 'show-all-layers':
        this.showAllLayers();
        break;
      case 'select-scene':
        this.goToScene(action.sceneId);
        break;
      case 'toggle-play-scenes':
        this.toggleScenePlayback();
        break;
      case 'step-scene':
        this.stepScene(action.delta);
        break;
      case 'toggle-edges':
        this.setCadEdgesVisible(!this.showCadEdges);
        break;
      case 'exit-xr':
        void this.exitXR();
        break;
    }
    this.syncSpatialPanel();
  }

  private syncSpatialPanel(): void {
    this.spatialPanel.updateState({
      modelName: this.currentModel?.name ?? 'Sin modelo',
      backgroundMode: this.backgroundMode,
      layers: this.getLayersSnapshot(),
      scenes: this.scenes,
      playback: this.playback,
      scale: this.modelPivot.scale.x,
      showEdges: this.showCadEdges,
    });
  }

  public loadModel(model: LoadedModel, customScenes: ViewerScene[] = []): void {
    this.clearCurrentModel();

    this.currentModel = model;
    this.scenes = [...model.scenes, ...customScenes];

    this.layerVisibility.clear();
    for (const l of model.layers) {
      this.layerVisibility.set(l.id, l.visible);
    }

    this.nodeVisibility.clear();
    const initNodeVis = (node: LoadedModel['tree']) => {
      this.nodeVisibility.set(node.id, node.visible);
      node.children.forEach(initNodeVis);
    };
    initNodeVis(model.tree);

    this.modelPivot.position.set(0, 0, 0);
    this.modelPivot.rotation.set(0, 0, 0);
    this.modelPivot.scale.set(1, 1, 1);
    this.modelPivot.add(model.root);

    // Compute clean auto-fit scale for comfortable initial inspection
    const maxDim = Math.max(...model.rawSize);
    this.baseFitScale = maxDim > 0.01 ? 1 : 1;
    // Keep 1:1 meters if reasonable architectural size (1m..40m), else normalize to ~6m
    if (maxDim > 45 || maxDim < 0.25) {
      this.baseFitScale = 6 / Math.max(0.001, maxDim);
      this.modelPivot.scale.setScalar(this.baseFitScale);
    }

    // Set up AnimationMixer if model has glTF / Collada animations
    if (model.animationClips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model.root);
      const firstClip = model.animationClips[0];
      this.activeAction = this.mixer.clipAction(firstClip);
      this.playback = {
        ...this.playback,
        isPlaying: false,
        activeClipName: firstClip.name || 'Animación 1',
        clipTime: 0,
        clipDuration: firstClip.duration,
      };
    } else {
      this.mixer = null;
      this.activeAction = null;
      this.playback = {
        ...this.playback,
        isPlaying: false,
        activeClipName: null,
        clipTime: 0,
        clipDuration: 0,
      };
    }

    this.applyVisibility();
    this.applyCadEdges();
    if (this.xrayMode) this.setXRayMode(true);

    if (this.transformMode !== 'none' && !this.xrSession) {
      this.transformControls.attach(this.modelPivot);
      this.transformHelper.visible = true;
    }

    // Frame camera nicely (or jump to first SketchUp scene if present)
    if (this.scenes.length > 0 && this.scenes[0].camera && !this.xrSession) {
      this.applyCameraSnapshotImmediate(this.scenes[0].camera);
      this.playback.activeSceneId = this.scenes[0].id;
    } else {
      this.fitCameraToModel();
    }

    this.emitTransform();
    this.callbacks.onPlaybackChange({ ...this.playback });
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
    this.syncSpatialPanel();
  }

  private clearCurrentModel(): void {
    this.stopPlayback();
    this.selectNode(null);
    if (this.xrayMode) this.restoreMaterialsFromXRay();
    this.savedMaterials.clear();

    if (this.currentModel) {
      this.transformControls.detach();
      this.transformHelper.visible = false;
      this.modelPivot.remove(this.currentModel.root);
      this.currentModel.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m && m !== this.xrayMaterial) {
              const std = m as THREE.MeshStandardMaterial;
              std.map?.dispose();
              m.dispose();
            }
          });
        }
      });
      this.currentModel = null;
    }
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.activeAction = null;
  }

  public fitCameraToModel(): void {
    if (!this.currentModel) return;
    this.modelPivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.modelPivot);
    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.5);
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (maxDim / (2 * Math.tan(fovRad / 2))) * 1.45;

    const dir = new THREE.Vector3(0.75, 0.45, 0.85).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.orbitControls.target.copy(center);
    this.orbitControls.update();
  }

  public setBackgroundMode(mode: BackgroundMode): void {
    this.backgroundMode = mode;
    const isTransparent = mode === 'passthrough' || mode === 'camera';

    this.envGroup.visible = !isTransparent;
    this.shadowCatcherFloor.visible = true;

    if (isTransparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      (this.shadowCatcherFloor.material as THREE.ShadowMaterial).opacity = 0.28;
    } else if (mode === 'dark') {
      this.scene.background = new THREE.Color('#0b111b');
      this.renderer.setClearColor(0x0b111b, 1);
      const skyMat = this.skyDome.material as THREE.ShaderMaterial;
      skyMat.uniforms.topColor.value.set('#0b111b');
      skyMat.uniforms.horizonColor.value.set('#162235');
      skyMat.uniforms.bottomColor.value.set('#090e17');
      (this.studioFloor.material as THREE.MeshStandardMaterial).color.set('#111b2b');
      (this.studioFloor.material as THREE.MeshStandardMaterial).opacity = 0.75;
      (this.shadowCatcherFloor.material as THREE.ShadowMaterial).opacity = 0.35;
    } else {
      // Studio light architectural environment
      this.scene.background = new THREE.Color('#dbe7f3');
      this.renderer.setClearColor(0xdbe7f3, 1);
      const skyMat = this.skyDome.material as THREE.ShaderMaterial;
      skyMat.uniforms.topColor.value.set('#bfd9f4');
      skyMat.uniforms.horizonColor.value.set('#eef4fa');
      skyMat.uniforms.bottomColor.value.set('#cfdbe6');
      (this.studioFloor.material as THREE.MeshStandardMaterial).color.set('#e2e8f0');
      (this.studioFloor.material as THREE.MeshStandardMaterial).opacity = 0.65;
      (this.shadowCatcherFloor.material as THREE.ShadowMaterial).opacity = 0.2;
    }

    this.callbacks.onBackgroundChange(mode);
    this.syncSpatialPanel();
  }

  public setTransformMode(mode: TransformMode): void {
    this.transformMode = mode;
    if (mode === 'none' || !this.currentModel || this.xrSession) {
      this.transformControls.detach();
      this.transformHelper.visible = false;
      return;
    }
    this.transformControls.setMode(mode);
    this.transformControls.attach(this.modelPivot);
    this.transformHelper.visible = true;
  }

  public setModelTransform(next: Partial<ModelTransform>): void {
    if (next.position) {
      this.modelPivot.position.set(next.position[0], next.position[1], next.position[2]);
    }
    if (next.rotationDeg) {
      this.modelPivot.rotation.set(
        THREE.MathUtils.degToRad(next.rotationDeg[0]),
        THREE.MathUtils.degToRad(next.rotationDeg[1]),
        THREE.MathUtils.degToRad(next.rotationDeg[2]),
      );
    }
    if (next.scale !== undefined) {
      const clamped = Math.max(0.005, Math.min(50, next.scale));
      this.modelPivot.scale.setScalar(clamped);
    }
    this.emitTransform();
    this.syncSpatialPanel();
  }

  public applyScalePreset(preset: 'fit' | '1:1' | '1:10' | '1:20' | '1:50' | '1:100'): void {
    if (!this.currentModel) return;
    if (preset === 'fit') {
      if (this.xrSession) {
        this.positionModelForXR(1.2);
      } else {
        this.modelPivot.scale.setScalar(this.baseFitScale);
        this.emitTransform();
        this.fitCameraToModel();
      }
      return;
    }
    const factorMap: Record<Exclude<typeof preset, 'fit'>, number> = {
      '1:1': 1,
      '1:10': 0.1,
      '1:20': 0.05,
      '1:50': 0.02,
      '1:100': 0.01,
    };
    this.modelPivot.scale.setScalar(factorMap[preset]);
    this.emitTransform();
    this.syncSpatialPanel();
  }

  public snapToFloor(): void {
    if (!this.currentModel) return;
    this.modelPivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.modelPivot);
    if (!box.isEmpty()) {
      this.modelPivot.position.y -= box.min.y;
      this.emitTransform();
    }
  }

  public resetTransform(): void {
    this.modelPivot.position.set(0, 0, 0);
    this.modelPivot.rotation.set(0, 0, 0);
    this.modelPivot.scale.setScalar(this.baseFitScale);
    this.emitTransform();
    if (!this.xrSession) this.fitCameraToModel();
  }

  private enforceUniformScale(): void {
    const s = this.modelPivot.scale;
    if (Math.abs(s.x - s.y) > 1e-4 || Math.abs(s.x - s.z) > 1e-4) {
      const avg = Math.max(0.005, (s.x + s.y + s.z) / 3);
      s.setScalar(avg);
    }
  }

  private emitTransform(): void {
    const t: ModelTransform = {
      position: [
        Number(this.modelPivot.position.x.toFixed(3)),
        Number(this.modelPivot.position.y.toFixed(3)),
        Number(this.modelPivot.position.z.toFixed(3)),
      ],
      rotationDeg: [
        Math.round(THREE.MathUtils.radToDeg(this.modelPivot.rotation.x)),
        Math.round(THREE.MathUtils.radToDeg(this.modelPivot.rotation.y)),
        Math.round(THREE.MathUtils.radToDeg(this.modelPivot.rotation.z)),
      ],
      scale: Number(this.modelPivot.scale.x.toFixed(4)),
    };
    this.callbacks.onTransformChange(t);
  }

  // ==================== LAYERS & ELEMENTS MANAGEMENT ====================

  public getLayersSnapshot(): LayerInfo[] {
    if (!this.currentModel) return [];
    return this.currentModel.layers.map((l) => ({
      ...l,
      visible: this.layerVisibility.get(l.id) ?? l.visible,
    }));
  }

  public setLayerVisible(layerId: string, visible: boolean): void {
    this.layerVisibility.set(layerId, visible);
    this.applyVisibility();
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
    this.syncSpatialPanel();
  }

  public isolateLayer(layerId: string): void {
    if (!this.currentModel) return;
    for (const l of this.currentModel.layers) {
      this.layerVisibility.set(l.id, l.id === layerId);
    }
    this.applyVisibility();
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
    this.syncSpatialPanel();
  }

  public showAllLayers(): void {
    if (!this.currentModel) return;
    for (const l of this.currentModel.layers) {
      this.layerVisibility.set(l.id, true);
    }
    this.applyVisibility();
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
    this.syncSpatialPanel();
  }

  public hideAllLayers(): void {
    if (!this.currentModel) return;
    for (const l of this.currentModel.layers) {
      this.layerVisibility.set(l.id, false);
    }
    this.applyVisibility();
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
    this.syncSpatialPanel();
  }

  public setNodeVisible(nodeId: string, visible: boolean): void {
    this.nodeVisibility.set(nodeId, visible);
    this.applyVisibility();
  }

  public isolateNode(nodeId: string): void {
    if (!this.currentModel) return;
    const ancestorSet = new Set<string>();
    const descendantSet = new Set<string>();

    const collectDescendants = (node: LoadedModel['tree']) => {
      descendantSet.add(node.id);
      node.children.forEach(collectDescendants);
    };

    const findPath = (node: LoadedModel['tree']): boolean => {
      if (node.id === nodeId) {
        ancestorSet.add(node.id);
        collectDescendants(node);
        return true;
      }
      for (const child of node.children) {
        if (findPath(child)) {
          ancestorSet.add(node.id);
          return true;
        }
      }
      return false;
    };

    findPath(this.currentModel.tree);
    for (const key of this.nodeVisibility.keys()) {
      this.nodeVisibility.set(key, ancestorSet.has(key) || descendantSet.has(key));
    }
    // Also ensure the target's layer is visible
    const targetObj = this.currentModel.nodeMap.get(nodeId);
    const layerId = targetObj?.userData?.layerId as string | undefined;
    if (layerId) this.layerVisibility.set(layerId, true);

    this.applyVisibility();
    this.callbacks.onLayersChanged(this.getLayersSnapshot());
  }

  public showAllNodes(): void {
    for (const key of this.nodeVisibility.keys()) {
      this.nodeVisibility.set(key, true);
    }
    this.applyVisibility();
  }

  public getNodeVisibilityMap(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.nodeVisibility.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  private applyVisibility(): void {
    if (!this.currentModel) return;

    const visit = (node: LoadedModel['tree'], parentVisible: boolean) => {
      const obj = this.currentModel!.nodeMap.get(node.id);
      const ownVis = this.nodeVisibility.get(node.id) ?? true;
      const effectiveNodeVis = parentVisible && ownVis;

      if (obj) {
        // Group visibility follows node hierarchy; individual meshes ALSO check their layer visibility!
        obj.visible = effectiveNodeVis;
        for (const child of obj.children) {
          if (child instanceof THREE.Mesh && child.userData?.isModelMesh) {
            const meshLayer = (child.userData.layerId as string | undefined) ?? node.layerId;
            const layerVis = this.layerVisibility.get(meshLayer) ?? true;
            child.visible = effectiveNodeVis && layerVis;
          }
        }
        // If obj itself is a Mesh (glTF / Collada / OBJ)
        if (obj instanceof THREE.Mesh && obj.userData?.isModelMesh) {
          const layerVis = this.layerVisibility.get(node.layerId) ?? true;
          obj.visible = effectiveNodeVis && layerVis;
        }
      }

      for (const childNode of node.children) {
        visit(childNode, effectiveNodeVis);
      }
    };

    visit(this.currentModel.tree, true);
    this.updateSelectionHighlight();
  }

  public setCadEdgesVisible(visible: boolean): void {
    this.showCadEdges = visible;
    this.applyCadEdges();
    this.callbacks.onEdgesChange?.(visible);
    this.syncSpatialPanel();
  }

  private applyCadEdges(): void {
    if (!this.currentModel) return;
    this.currentModel.root.traverse((obj) => {
      if (obj.userData?.isCadEdge) {
        obj.visible = this.showCadEdges;
      }
    });
  }

  public setXRayMode(enabled: boolean): void {
    this.xrayMode = enabled;
    if (!this.currentModel) return;
    if (enabled) {
      this.currentModel.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData?.isModelMesh) {
          if (!this.savedMaterials.has(obj)) {
            this.savedMaterials.set(obj, obj.material);
          }
          obj.material = this.xrayMaterial;
        }
      });
    } else {
      this.restoreMaterialsFromXRay();
    }
  }

  private restoreMaterialsFromXRay(): void {
    for (const [mesh, originalMat] of this.savedMaterials.entries()) {
      mesh.material = originalMat;
    }
    this.savedMaterials.clear();
  }

  public selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.updateSelectionHighlight();
    this.callbacks.onSelectionChange(nodeId);
  }

  public focusOnNode(nodeId: string): void {
    if (!this.currentModel || this.xrSession) return;
    const obj = this.currentModel.nodeMap.get(nodeId);
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(size.length() * 0.6, 0.8);
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize();
    if (dir.lengthSq() < 0.01) dir.set(1, 0.6, 1).normalize();
    const endPos = center.clone().addScaledVector(dir, radius * 2.2);

    this.activeTransition = {
      startPos: this.camera.position.clone(),
      endPos,
      startTarget: this.orbitControls.target.clone(),
      endTarget: center,
      startFov: this.camera.fov,
      endFov: this.camera.fov,
      elapsed: 0,
      duration: 0.75,
    };
  }

  private updateSelectionHighlight(): void {
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.dispose();
      this.selectionBox = null;
    }
    if (!this.selectedNodeId || !this.currentModel || this.selectedNodeId === 'node-root') return;
    const obj = this.currentModel.nodeMap.get(this.selectedNodeId);
    if (!obj || !obj.visible) return;
    const helper = new THREE.BoxHelper(obj, 0x38bdf8);
    this.selectionBox = helper;
    this.scene.add(helper);
  }

  // ==================== SCENES & ANIMATION PLAYBACK ====================

  public getScenes(): ViewerScene[] {
    return [...this.scenes];
  }

  public setScenes(nextScenes: ViewerScene[]): void {
    this.scenes = [...nextScenes];
    this.syncSpatialPanel();
  }

  public captureCurrentScene(name: string): ViewerScene {
    const invPivot = this.modelPivot.matrixWorld.clone().invert();
    const localPos = this.camera.position.clone().applyMatrix4(invPivot);
    const localTarget = this.orbitControls.target.clone().applyMatrix4(invPivot);

    const hiddenLayerIds: string[] = [];
    this.layerVisibility.forEach((vis, id) => {
      if (!vis) hiddenLayerIds.push(id);
    });

    const hiddenNodeIds: string[] = [];
    this.nodeVisibility.forEach((vis, id) => {
      if (!vis) hiddenNodeIds.push(id);
    });

    const scene: ViewerScene = {
      id: `custom-scene-${Date.now()}`,
      name,
      description: 'Escena capturada por el usuario',
      source: 'custom',
      camera: {
        position: [
          Number(localPos.x.toFixed(3)),
          Number(localPos.y.toFixed(3)),
          Number(localPos.z.toFixed(3)),
        ],
        target: [
          Number(localTarget.x.toFixed(3)),
          Number(localTarget.y.toFixed(3)),
          Number(localTarget.z.toFixed(3)),
        ],
        fov: Math.round(this.camera.fov),
      },
      hiddenLayerIds,
      hiddenNodeIds,
      transitionSec: 2.0,
      delaySec: 2.0,
      includeInAnimation: true,
    };

    this.scenes.push(scene);
    this.playback.activeSceneId = scene.id;
    this.callbacks.onPlaybackChange({ ...this.playback });
    this.syncSpatialPanel();
    return scene;
  }

  public goToScene(sceneId: string, instant = false): void {
    const target = this.scenes.find((s) => s.id === sceneId);
    if (!target || !this.currentModel) return;

    this.playback.activeSceneId = target.id;
    this.sceneHoldTimer = 0;

    // 1. Apply scene's SketchUp layer visibility states!
    if (target.hiddenLayerIds !== undefined) {
      const hiddenSet = new Set(target.hiddenLayerIds);
      for (const l of this.currentModel.layers) {
        this.layerVisibility.set(l.id, !hiddenSet.has(l.id));
      }
      this.callbacks.onLayersChanged(this.getLayersSnapshot());
    }

    // 2. Apply scene's hidden node overrides if present
    if (target.hiddenNodeIds !== undefined) {
      const hiddenNodes = new Set(target.hiddenNodeIds);
      for (const key of this.nodeVisibility.keys()) {
        this.nodeVisibility.set(key, !hiddenNodes.has(key));
      }
    }
    this.applyVisibility();

    // 3. Activate linked glTF/Collada animation clip if present
    if (target.animationClipName && this.currentModel.animationClips.length > 0) {
      this.selectAnimationClip(target.animationClipName, true);
    }

    // 4. Smoothly transition camera (in desktop/2D) OR gently rotate model in XR!
    if (target.camera) {
      if (this.xrSession) {
        // In WebXR, keep the user's real head comfortable by gently turning the model to face the scene direction
        const dx = target.camera.position[0] - target.camera.target[0];
        const dz = target.camera.position[2] - target.camera.target[2];
        const desiredYaw = Math.atan2(-dx, dz);
        this.modelPivot.rotation.y = desiredYaw;
        this.emitTransform();
      } else if (instant || target.transitionSec <= 0.05) {
        this.applyCameraSnapshotImmediate(target.camera);
      } else {
        const worldTarget = this.modelLocalToWorld(target.camera.target);
        const worldPos = this.modelLocalToWorld(target.camera.position);
        this.activeTransition = {
          startPos: this.camera.position.clone(),
          endPos: worldPos,
          startTarget: this.orbitControls.target.clone(),
          endTarget: worldTarget,
          startFov: this.camera.fov,
          endFov: target.camera.fov || 45,
          elapsed: 0,
          duration: Math.max(0.25, target.transitionSec / Math.max(0.2, this.playback.speed)),
        };
      }
    }

    this.callbacks.onPlaybackChange({ ...this.playback });
    this.syncSpatialPanel();
  }

  private modelLocalToWorld(pt: [number, number, number]): THREE.Vector3 {
    this.modelPivot.updateMatrixWorld(true);
    return new THREE.Vector3(pt[0], pt[1], pt[2]).applyMatrix4(this.modelPivot.matrixWorld);
  }

  private applyCameraSnapshotImmediate(snap: CameraSnapshot): void {
    this.activeTransition = null;
    const wp = this.modelLocalToWorld(snap.position);
    const wt = this.modelLocalToWorld(snap.target);
    this.camera.position.copy(wp);
    this.camera.fov = snap.fov || 45;
    this.camera.updateProjectionMatrix();
    this.orbitControls.target.copy(wt);
    this.orbitControls.update();
  }

  public toggleScenePlayback(): void {
    if (this.playback.isPlaying) {
      this.stopPlayback();
      return;
    }

    // Play scenes tour and/or active glTF AnimationClip
    const playableScenes = this.scenes.filter((s) => s.includeInAnimation);
    if (playableScenes.length === 0 && !this.activeAction) {
      this.callbacks.onToast?.('Este modelo no tiene escenas ni animaciones. Captura escenas propias primero.');
      return;
    }

    this.playback.isPlaying = true;
    this.sceneHoldTimer = 0;

    if (this.activeAction) {
      this.activeAction.paused = false;
      this.activeAction.play();
    }

    if (playableScenes.length > 0) {
      const currentIdx = playableScenes.findIndex((s) => s.id === this.playback.activeSceneId);
      const nextScene = playableScenes[(currentIdx + 1) % playableScenes.length];
      this.goToScene(nextScene.id);
    }

    this.callbacks.onPlaybackChange({ ...this.playback });
    this.syncSpatialPanel();
  }

  public stopPlayback(): void {
    this.playback.isPlaying = false;
    this.activeTransition = null;
    if (this.activeAction) {
      this.activeAction.paused = true;
    }
    this.callbacks.onPlaybackChange({ ...this.playback });
    this.syncSpatialPanel();
  }

  public stepScene(delta: -1 | 1): void {
    const playable = this.scenes.filter((s) => s.includeInAnimation);
    if (playable.length === 0) return;
    const idx = playable.findIndex((s) => s.id === this.playback.activeSceneId);
    const nextIdx = idx < 0 ? 0 : (idx + delta + playable.length) % playable.length;
    this.goToScene(playable[nextIdx].id);
  }

  public setPlaybackSpeed(speed: number): void {
    this.playback.speed = Math.max(0.25, Math.min(3, speed));
    if (this.mixer) {
      this.mixer.timeScale = this.playback.speed;
    }
    this.callbacks.onPlaybackChange({ ...this.playback });
  }

  public setSceneLoop(loop: boolean): void {
    this.playback.sceneLoop = loop;
    this.callbacks.onPlaybackChange({ ...this.playback });
  }

  public selectAnimationClip(clipName: string, autoPlay = false): void {
    if (!this.currentModel || !this.mixer) return;
    const clip = this.currentModel.animationClips.find(
      (c, i) => (c.name || `clip_${i}`) === clipName,
    );
    if (!clip) return;
    this.mixer.stopAllAction();
    this.activeAction = this.mixer.clipAction(clip);
    this.activeAction.setLoop(
      this.playback.clipLoop ? THREE.LoopRepeat : THREE.LoopOnce,
      Infinity,
    );
    this.activeAction.clampWhenFinished = true;
    this.activeAction.play();
    this.activeAction.paused = !autoPlay;
    this.playback.activeClipName = clipName;
    this.playback.clipDuration = clip.duration;
    this.playback.clipTime = 0;
    this.playback.isPlaying = autoPlay;
    this.callbacks.onPlaybackChange({ ...this.playback });
  }

  public seekAnimationClip(timeSec: number): void {
    if (!this.activeAction || !this.mixer) return;
    const clamped = Math.max(0, Math.min(this.playback.clipDuration, timeSec));
    this.activeAction.time = clamped;
    this.mixer.update(0);
    this.playback.clipTime = clamped;
    this.callbacks.onPlaybackChange({ ...this.playback });
  }

  // ==================== POINTER PICKING ====================

  private handlePointerDown = (ev: PointerEvent): void => {
    this.pointerDownPos.set(ev.clientX, ev.clientY);
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (this.xrSession || !this.currentModel) return;
    const dist = Math.hypot(ev.clientX - this.pointerDownPos.x, ev.clientY - this.pointerDownPos.y);
    if (dist > 6) return; // Ignore orbit/gizmo drags
    if (this.transformControls.dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.modelPivot.children, true);
    const meshHit = hits.find(
      (h) => h.object instanceof THREE.Mesh && h.object.visible && h.object.userData?.isModelMesh,
    );

    if (!meshHit) {
      this.selectNode(null);
      return;
    }
    const nodeId = meshHit.object.userData?.nodeId as string | undefined;
    this.selectNode(nodeId ?? null);
  };

  private handleResize = (): void => {
    if (this.disposed || this.xrSession) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ==================== MAIN ANIMATION & XR LOOP ====================

  private animate = (_time: number, frame?: XRFrame): void => {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);

    // 1. Update desktop camera transition
    if (this.activeTransition && !this.xrSession) {
      const tr = this.activeTransition;
      tr.elapsed += dt;
      const rawT = Math.min(1, tr.elapsed / tr.duration);
      const t = easeInOutCubic(rawT);

      this.camera.position.lerpVectors(tr.startPos, tr.endPos, t);
      this.orbitControls.target.lerpVectors(tr.startTarget, tr.endTarget, t);
      this.camera.fov = THREE.MathUtils.lerp(tr.startFov, tr.endFov, t);
      this.camera.updateProjectionMatrix();
      this.playback.transitionProgress = rawT;

      if (rawT >= 1) {
        this.activeTransition = null;
        this.playback.transitionProgress = 1;
      }
    }

    // 2. Continuous Scenes tour auto-advance
    if (this.playback.isPlaying && !this.activeTransition) {
      const playable = this.scenes.filter((s) => s.includeInAnimation && s.camera);
      if (playable.length > 1) {
        const curIdx = playable.findIndex((s) => s.id === this.playback.activeSceneId);
        const curScene = playable[curIdx >= 0 ? curIdx : 0];
        this.sceneHoldTimer += dt * this.playback.speed;
        if (this.sceneHoldTimer >= Math.max(0.5, curScene.delaySec)) {
          this.sceneHoldTimer = 0;
          const nextIdx = (curIdx + 1) % playable.length;
          if (nextIdx === 0 && !this.playback.sceneLoop) {
            this.stopPlayback();
          } else {
            this.goToScene(playable[nextIdx].id);
          }
        }
      }
    }

    // 3. Update AnimationMixer (glTF / Collada clips)
    if (this.mixer && this.activeAction && !this.activeAction.paused) {
      this.mixer.update(dt);
      this.playback.clipTime = this.activeAction.time % Math.max(0.001, this.playback.clipDuration);
    }

    // 4. WebXR Frame Processing (Hit-Test, Grab, Hand Pinch, Thumbsticks, Spatial Panel)
    if (frame && this.xrSession) {
      this.updateXRFrame(frame, dt);
    } else {
      this.orbitControls.update();
    }

    if (this.selectionBox) {
      this.selectionBox.update();
    }

    // Periodic UI sync for clip scrubbers / transition progress
    const now = performance.now();
    if (this.playback.isPlaying && now - this.lastUiSync > 120) {
      this.lastUiSync = now;
      this.callbacks.onPlaybackChange({ ...this.playback });
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateXRFrame(frame: XRFrame, dt: number): void {
    const session = frame.session;
    const refSpace = this.renderer.xr.getReferenceSpace();

    // A. Request AR hit-test source once
    if (
      this.xrStatus.activeMode === 'immersive-ar' &&
      !this.hitTestRequested &&
      typeof session.requestHitTestSource === 'function'
    ) {
      this.hitTestRequested = true;
      session
        .requestReferenceSpace('viewer')
        .then((viewerSpace) => session.requestHitTestSource?.({ space: viewerSpace }))
        .then((source) => {
          if (source) {
            this.hitTestSource = source;
            this.xrStatus.hitTestAvailable = true;
            this.callbacks.onXRStatusChange({ ...this.xrStatus });
          }
        })
        .catch(() => {
          // Hit-test optional
        });
    }

    // B. Update AR reticle pose
    if (this.hitTestSource && refSpace && this.xrStatus.placementActive) {
      const results = frame.getHitTestResults(this.hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        this.reticle.visible = false;
      }
    } else {
      this.reticle.visible = false;
    }

    // C. Update Hand-Tracking Pinch-to-Grab detection
    this.xrHands.forEach((hand, i) => {
      const joints = hand.joints as Record<string, THREE.Object3D | undefined> | undefined;
      const thumbTip = joints?.['thumb-tip'];
      const indexTip = joints?.['index-finger-tip'];
      if (thumbTip && indexTip && thumbTip.visible && indexTip.visible) {
        const pinchDist = thumbTip.position.distanceTo(indexTip.position);
        const state = this.grabbers[i];
        if (pinchDist < 0.022 && !state.pinching) {
          state.pinching = true;
          this.onXRSelectStart(i);
        } else if (pinchDist > 0.042 && state.pinching) {
          state.pinching = false;
          this.onXRSelectEnd(i);
        }
      }
    });

    // D. Update 1-hand and 2-hand Grab transformations
    if (this.twoHandActive && this.grabbers[0].grabbing && this.grabbers[1].grabbing) {
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      this.grabbers[0].controller.getWorldPosition(p0);
      this.grabbers[1].controller.getWorldPosition(p1);

      const curDist = Math.max(0.04, p0.distanceTo(p1));
      const scaleRatio = curDist / this.twoHandStartDist;
      const nextScale = Math.max(0.01, Math.min(20, this.twoHandStartScale * scaleRatio));
      this.modelPivot.scale.setScalar(nextScale);

      const curAngle = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      this.modelPivot.rotation.y = this.twoHandStartRotY - (curAngle - this.twoHandStartAngle);

      const curMid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
      const deltaMid = curMid.sub(this.twoHandStartMid);
      this.modelPivot.position.copy(this.twoHandPivotStartPos).add(deltaMid);
    } else {
      const active = this.grabbers.find((g) => g.grabbing);
      if (active) {
        active.controller.updateMatrixWorld(true);
        const deltaMat = new THREE.Matrix4().multiplyMatrices(
          active.controller.matrixWorld,
          active.startMatrixInv,
        );
        const nextMat = new THREE.Matrix4().multiplyMatrices(deltaMat, active.pivotStartMatrix);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        nextMat.decompose(pos, quat, scl);
        this.modelPivot.position.copy(pos);
        this.modelPivot.quaternion.copy(quat);
      }
    }

    // E. Controller Thumbsticks & Buttons (Quest / VR / MR controllers)
    this.updateXRGamepads(session, dt);

    // F. Spatial Panel ray hover feedback
    if (this.spatialPanel.group.visible) {
      let hovered = false;
      for (const g of this.grabbers) {
        const hit = this.raycastFromController(g.controller, [this.spatialPanel.mesh]);
        if (hit && hit.uv) {
          this.spatialPanel.handleRayHover(hit.uv);
          hovered = true;
          break;
        }
      }
      if (!hovered) this.spatialPanel.handleRayHover(null);
    }
  }

  private updateXRGamepads(session: XRSession, dt: number): void {
    const deadzone = 0.16;
    const camDir = new THREE.Vector3();
    this.renderer.xr.getCamera().getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-4) camDir.set(0, 0, -1);
    camDir.normalize();
    const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

    for (const source of session.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;

      const axX = gp.axes[2] ?? gp.axes[0] ?? 0;
      const axY = gp.axes[3] ?? gp.axes[1] ?? 0;

      if (source.handedness === 'left') {
        // Left stick: move model in horizontal plane (or vertical if trigger pressed)
        const triggerHeld = Boolean(gp.buttons[0]?.pressed);
        if (Math.abs(axX) > deadzone) {
          this.modelPivot.position.addScaledVector(camRight, axX * 1.4 * dt);
        }
        if (Math.abs(axY) > deadzone) {
          if (triggerHeld) {
            this.modelPivot.position.y -= axY * 1.2 * dt;
          } else {
            this.modelPivot.position.addScaledVector(camDir, -axY * 1.4 * dt);
          }
        }
        // X/Y buttons on left controller: toggle Spatial Panel / Passthrough
        this.edgeButton(`left-4`, Boolean(gp.buttons[4]?.pressed), () => this.toggleSpatialPanel());
        this.edgeButton(`left-5`, Boolean(gp.buttons[5]?.pressed), () =>
          this.setBackgroundMode(this.backgroundMode === 'passthrough' ? 'studio' : 'passthrough'),
        );
      } else if (source.handedness === 'right') {
        // Right stick X: rotate yaw; Right stick Y: uniform scale
        if (Math.abs(axX) > deadzone) {
          this.modelPivot.rotation.y += axX * 1.8 * dt;
        }
        if (Math.abs(axY) > deadzone) {
          const factor = 1 - axY * 0.9 * dt;
          const nextScale = Math.max(0.01, Math.min(20, this.modelPivot.scale.x * factor));
          this.modelPivot.scale.setScalar(nextScale);
        }
        // A/B buttons on right controller: Play/Pause Scenes / Next Scene
        this.edgeButton(`right-4`, Boolean(gp.buttons[4]?.pressed), () => this.toggleScenePlayback());
        this.edgeButton(`right-5`, Boolean(gp.buttons[5]?.pressed), () => this.stepScene(1));
      }
    }
  }

  private edgeButton(key: string, pressed: boolean, onPress: () => void): void {
    const prev = this.buttonLatch.get(key) ?? false;
    if (pressed && !prev) onPress();
    this.buttonLatch.set(key, pressed);
  }

  public dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.clearCurrentModel();
    this.spatialPanel.dispose();
    this.orbitControls.dispose();
    this.transformControls.dispose();
    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();
    this.xrayMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
