import * as THREE from 'three';
import { clamp, damp } from '../utils/math';

/**
 * Drives the first-person camera along the -Z path: eased start, smooth stops
 * at hold points, gentle sway/banking and short decaying impact impulses.
 */
export class CameraController {
  z = 0;
  prevZ = 0;
  speed = 0;
  baseSpeed = 8;
  private startT = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  private kick = 0;
  reducedMotion = false;
  /** Extra forward boost used by the end-of-level fly-through. */
  boost = 0;

  constructor(public camera: THREE.PerspectiveCamera) {}

  reset(baseSpeed: number, z = 0) {
    this.baseSpeed = baseSpeed;
    this.z = this.prevZ = z;
    this.speed = 0;
    this.startT = 0;
    this.shakeAmp = 0;
    this.kick = 0;
    this.boost = 0;
  }

  shake(a: number) { this.shakeAmp = Math.min(0.6, this.shakeAmp + a * (this.reducedMotion ? 0.3 : 1)); }
  impulse(a: number) { this.kick = Math.max(this.kick, a); }

  /** hold: world z where the camera must stop, or null. */
  update(dt: number, time: number, hold: number | null) {
    this.startT += dt;
    // Anticipation: brief stillness, then a smooth acceleration.
    const ramp = clamp((this.startT - 0.8) / 2.4, 0, 1);
    let desired = this.baseSpeed * (ramp * ramp * (3 - 2 * ramp)) + this.boost;
    if (hold !== null) {
      const dist = this.z - hold;
      desired = dist <= 0 ? 0 : Math.min(desired, Math.sqrt(2 * 7 * dist));
    }
    this.speed = damp(this.speed, desired, desired < this.speed ? 6 : 2.5, dt);
    this.prevZ = this.z;
    this.z -= this.speed * dt;
    if (hold !== null && this.prevZ >= hold && this.z < hold) { this.z = hold; this.speed = 0; }
    this.apply(dt, time);
  }

  /** Position/orientation only (used while paused-free states like menus). */
  apply(dt: number, time: number) {
    const m = this.reducedMotion ? 0.25 : 1;
    const cam = this.camera;
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.6);
    this.shakeT += dt * 38;
    this.kick = Math.max(0, this.kick - dt * 3);
    const sx = (Math.sin(this.shakeT * 1.1) + Math.sin(this.shakeT * 2.3) * 0.5) * this.shakeAmp * 0.25;
    const sy = (Math.sin(this.shakeT * 1.7 + 1) + Math.sin(this.shakeT * 2.9) * 0.5) * this.shakeAmp * 0.25;
    cam.position.set(Math.sin(time * 0.33) * 0.22 * m + sx, Math.sin(time * 0.51) * 0.1 * m + sy, this.z + this.kick * 0.6);
    cam.rotation.set(Math.sin(time * 0.41) * 0.008 * m + sy * 0.05, Math.sin(time * 0.29) * 0.01 * m, Math.sin(time * 0.27) * 0.012 * m + sx * 0.04);
    cam.updateMatrixWorld();
  }
}
