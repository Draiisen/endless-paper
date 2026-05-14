// djb2 hash for a string. Fast and good enough for cache keys.
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  // Mix in length to further reduce collisions for typical data URLs
  return `${str.length.toString(36)}:${(h >>> 0).toString(36)}`;
}

export class LRUImageCache {
  private map = new Map<string, HTMLImageElement>();
  private maxSize: number;
  private onLoad: (() => void) | null = null;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  setOnLoad(cb: () => void): void {
    this.onLoad = cb;
  }

  get(src: string): HTMLImageElement {
    const key = djb2(src);
    const existing = this.map.get(key);
    if (existing) {
      // Mark as recently used: delete + re-insert so it moves to the end
      this.map.delete(key);
      this.map.set(key, existing);
      return existing;
    }

    const img = new Image();
    img.src = src;
    img.onload = () => { this.onLoad?.(); };
    this.map.set(key, img);

    // Evict oldest entries if over capacity
    while (this.map.size > this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }

    return img;
  }

  clear(): void {
    this.map.clear();
  }
}
