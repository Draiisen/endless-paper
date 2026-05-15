export type ToolType = 'pen' | 'select' | 'hand' | 'eraser' | 'image' | 'rect' | 'circle' | 'text' | 'pathedit' | 'stamp';

export interface Viewport {
  x: number;   // translation x in pixels
  y: number;   // translation y in pixels
  scale: number; // zoom level (1 = 100%)
}

export interface VectorPath {
  id: string;
  d: string;           // SVG path data
  stroke: string;      // CSS color
  strokeWidth: number;
  fill: string;
  opacity: number;
  pressureSensitive?: boolean;
}

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'both' | 'radial4' | 'radial6' | 'radial8';

export interface Hotspot {
  type: 'text' | 'window';
  trigger: 'click' | 'doubleclick' | 'hover';
  content: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface Portal {
  targetSceneId: string;
  targetCamera?: Viewport;
}

export interface NodeAnimation {
  type: 'pulse' | 'wobble' | 'float' | 'fade';
  intensity: number;
  speed: number;
}

export interface TextOnPath {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
}

export interface SceneNode {
  id: string;
  type: 'path' | 'image' | 'rect' | 'circle' | 'group' | 'text';

  // Bounding box in this scene's coordinate space
  x: number;
  y: number;
  width: number;
  height: number;

  // For path nodes
  path?: VectorPath;

  // For rect/circle
  stroke?: string;
  strokeWidth?: number;
  fill?: string;

  // For image nodes
  imageData?: string;  // base64 data URL

  // Vector representation of the image (after vectorization)
  vectorPaths?: VectorPath[];
  isVectorized?: boolean;

  // For text nodes
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  textAlign?: 'left' | 'center' | 'right';

  // Optional shared group identity for multi-select grouping
  groupId?: string;

  // Layer assignment (per-scene)
  layerId?: string;

  // Inner scene — content visible when you "enter" this node
  innerScene?: Scene;

  // Cached bounding box of the inner scene's nodes (for smooth zoom transitions)
  innerSceneBounds?: { x: number; y: number; width: number; height: number };

  // Hotspot UI (popup)
  hotspot?: Hotspot;

  // Portal to another scene
  portal?: Portal;

  // Subtle animation when in focus
  animation?: NodeAnimation;

  // Text rendered along this path's curve
  textAlongPath?: TextOnPath;

  // Marks reference image (renders below all)
  isReference?: boolean;
  referenceOpacity?: number; // 0..1, default 0.35

  // Level-of-detail data generated automatically on image import
  lod?: ImageLOD;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface SceneAudio {
  src: string;     // data URL
  volume: number;  // 0..1
  loop: boolean;
}

export interface Camera {
  id: string;
  name: string;
  viewport: Viewport;
  scenePath: string[];   // node-id path from root to scene the viewport is in
  duration: number;      // ms to hold
  transitionMs: number;  // ms to animate in
}

export interface StartCamera {
  viewport: Viewport;
  scenePath: string[];
}

export interface Scene {
  id: string;
  nodes: SceneNode[];
  background: string;  // CSS color e.g. '#ffffff'
  layers?: Layer[];
  audio?: SceneAudio;
  cameras?: Camera[];
  startCamera?: StartCamera;
}

export interface HistoryEntry {
  scene: Scene;
  viewport: Viewport;
}

export interface SceneLevel {
  scene: Scene;
  parentNodeId: string;   // which node we entered
  label: string;          // display name for breadcrumb
  viewportWhenLeft: Viewport;  // restore when going back
  enterFromNodeRect?: { x: number; y: number; width: number; height: number; scale: number };
}

export interface Asset {
  id: string;
  name: string;
  thumbnail: string;        // data URL
  nodes: SceneNode[];
  boundingBox: { width: number; height: number };
  createdAt: number;
  tags?: string[];
}

export interface ColorLayer {
  color: string;        // CSS color of this cluster
  paths: VectorPath[];  // paths already in world-space coordinates
}

export interface ImageLOD {
  thumbnail?: string;           // 64px JPEG for tiny zoom-out preview
  colorLayers?: ColorLayer[];   // multi-color vector paths in SOURCE-PIXEL space
  sourceW: number;              // pixel width used for tracing  (for rendering transform)
  sourceH: number;              // pixel height used for tracing
  naturalW?: number;            // original image natural width   (for LOD threshold)
  naturalH?: number;            // original image natural height
  vectorLoadedAt?: number;      // timestamp (ms) when color vectors finished loading
}

export interface BrushStamp {
  id: string;
  name: string;
  imageData: string;          // data URL of the stamp
  spacing: number;            // % of size
  size: number;               // base size in px
  rotationMode: 'fixed' | 'random' | 'follow';
  opacity: number;
}

export interface PersistedState {
  version: 1;
  rootScene: Scene;
  viewport: Viewport;
  savedAt: number;
  assets?: Asset[];
  brushStamps?: BrushStamp[];
}
