export type ToolType = 'pen' | 'select' | 'hand' | 'eraser' | 'image' | 'rect' | 'circle';

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
}

export interface SceneNode {
  id: string;
  type: 'path' | 'image' | 'rect' | 'circle' | 'group';

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

  // Inner scene — content visible when you "enter" this node
  innerScene?: Scene;
}

export interface Scene {
  id: string;
  nodes: SceneNode[];
  background: string;  // CSS color e.g. '#ffffff'
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
}
