import { SceneAudio } from '../types/scene';

// Simple cross-fading audio manager. One element pool, swaps on scene change.
class AudioManager {
  private current: HTMLAudioElement | null = null;
  private currentSrc = '';
  private muted = false;
  private fadeRaf = 0;

  setMuted(m: boolean) {
    this.muted = m;
    if (this.current) this.current.muted = m;
  }

  isMuted() { return this.muted; }

  play(audio: SceneAudio | undefined, fadeMs = 600): void {
    if (!audio || !audio.src) {
      this.stop(fadeMs);
      return;
    }
    if (this.currentSrc === audio.src && this.current) {
      this.current.volume = audio.volume;
      this.current.loop = audio.loop;
      this.current.muted = this.muted;
      const p = this.current.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return;
    }
    const next = new Audio(audio.src);
    next.loop = audio.loop;
    next.muted = this.muted;
    next.volume = 0;
    const p = next.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    const target = audio.volume;
    const prev = this.current;
    this.current = next;
    this.currentSrc = audio.src;
    this.fadeBoth(prev, next, target, fadeMs);
  }

  stop(fadeMs = 400): void {
    const prev = this.current;
    this.current = null;
    this.currentSrc = '';
    this.fadeBoth(prev, null, 0, fadeMs);
  }

  private fadeBoth(out: HTMLAudioElement | null, into: HTMLAudioElement | null, intoTarget: number, ms: number): void {
    cancelAnimationFrame(this.fadeRaf);
    const start = performance.now();
    const outStart = out?.volume ?? 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / Math.max(1, ms));
      if (out) out.volume = Math.max(0, outStart * (1 - t));
      if (into) into.volume = Math.min(1, intoTarget * t);
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(tick);
      } else {
        if (out) {
          try { out.pause(); } catch { /* ignore */ }
        }
      }
    };
    this.fadeRaf = requestAnimationFrame(tick);
  }
}

export const audioManager = new AudioManager();
