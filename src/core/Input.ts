import { DESIGN_W, DESIGN_H } from '../utils/constants';

export interface InputHandlers {
  press(): void;
  release(heldSeconds: number): void;
  burst(): void;
  pause(): void;
  mute(): void;
  anyGesture(): void;
  /** A press was aborted without firing (e.g. the window lost focus). */
  cancelled(): void;
}

/**
 * Pointer / touch / keyboard input. Pointer positions are mapped through the
 * canvas rectangle, so letterboxing and scaling never skew aiming.
 */
export class InputManager {
  /** Normalised device coordinates of the aim point. */
  ndc = { x: 0, y: 0 };
  /** Aim point in 1920x1080 design pixels. */
  design = { x: DESIGN_W / 2, y: DESIGN_H / 2 };
  pressing = false;
  pressStart = 0;
  hasPointer = false;
  isTouch = false;
  enabled = false;
  private activePointer: number | null = null;
  private spaceDown = false;

  constructor(surface: HTMLElement, private canvas: HTMLCanvasElement, private h: InputHandlers) {
    surface.addEventListener('pointermove', (e) => this.move(e));
    surface.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => { if (this.pressing && e.pointerId === this.activePointer) { this.cancel(); this.h.cancelled(); } });
    surface.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Android raises contextmenu on a touch long-press; only a real right-click triggers the burst.
      if (this.enabled && !this.isTouch && (e as PointerEvent).pointerType !== 'touch') this.h.burst();
    });
    window.addEventListener('blur', () => { if (this.pressing || this.spaceDown) { this.cancel(); this.h.cancelled(); } });
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Prevent page scrolling / zoom gestures during play.
    surface.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    surface.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  private map(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    this.ndc.x = u * 2 - 1;
    this.ndc.y = -(v * 2 - 1);
    this.design.x = u * DESIGN_W;
    this.design.y = v * DESIGN_H;
  }

  private move(e: PointerEvent) {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    this.map(e);
    this.hasPointer = true;
    this.isTouch = e.pointerType === 'touch';
  }

  private down(e: PointerEvent) {
    this.h.anyGesture();
    if (!this.enabled) return;
    if (e.button === 2) return; // right click handled by contextmenu
    if (this.pressing) {
      // A second finger: release the first press immediately as a tap, then begin a new one.
      this.finish(performance.now());
    }
    this.isTouch = e.pointerType === 'touch';
    this.map(e);
    this.hasPointer = true;
    this.activePointer = e.pointerId;
    this.pressing = true;
    this.pressStart = performance.now();
    this.h.press();
  }

  private up(e: PointerEvent) {
    if (!this.pressing || e.pointerId !== this.activePointer) return;
    if (e.type !== 'pointercancel') this.map(e);
    this.finish(performance.now());
  }

  private finish(now: number) {
    this.pressing = false;
    this.activePointer = null;
    if (this.enabled) this.h.release((now - this.pressStart) / 1000);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (down) this.h.anyGesture();
    const k = e.key.toLowerCase();
    if (down && e.repeat && k !== ' ' && k !== 'enter') return;
    if (down && (k === 'escape' || k === 'p')) { this.h.pause(); return; }
    if (down && k === 'm') { this.h.mute(); return; }
    if (!this.enabled) return;
    if (k === ' ' || k === 'enter') {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') (e.target as HTMLElement).blur();
      if (down && e.repeat) { e.preventDefault(); return; }
      e.preventDefault();
      if (down && !this.spaceDown && !this.pressing) { this.spaceDown = true; this.pressing = true; this.pressStart = performance.now(); this.activePointer = -1; this.h.press(); }
      if (!down && this.spaceDown) { this.spaceDown = false; if (this.activePointer === -1) this.finish(performance.now()); }
    }
    if (down && (k === 'e' || k === 'shift' || k === 'f')) this.h.burst();
  }

  /** Abort any press without firing (e.g. when pausing). */
  cancel() { this.pressing = false; this.activePointer = null; this.spaceDown = false; }

  heldTime() { return this.pressing ? (performance.now() - this.pressStart) / 1000 : 0; }
}
