import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Settings } from '../utils/storage';

export type Quality = Settings['quality'];

export const QUALITY = {
  high: { dpr: 2, bloom: true, msaa: 4, fragments: 1, particles: 1, maxFragments: 320 },
  balanced: { dpr: 1.25, bloom: true, msaa: 0, fragments: 0.75, particles: 0.75, maxFragments: 200 },
  performance: { dpr: 1, bloom: false, msaa: 0, fragments: 0.5, particles: 0.5, maxFragments: 110 },
} as const;

/** WebGL renderer + restrained bloom post-processing with quality presets. */
export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  renderPass: RenderPass;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  quality: Quality = 'high';
  private w = 1; private h = 1;
  private slowFrames = 0;
  onAutoDowngrade?: (q: Quality) => void;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene; this.camera = camera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.bloom.enabled = QUALITY[q].bloom;
    const samples = QUALITY[q].msaa;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    this.resize(this.w, this.h);
  }

  get preset() { return QUALITY[this.quality]; }

  resize(w: number, h: number) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.w, this.h);
  }

  /** Bloom presets go through the composer; Performance renders straight to the canvas (tone mapping still applies). */
  render(dt: number) {
    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Called with the real frame time; drops a quality step if the device is struggling for several seconds. */
  monitor(frameDt: number) {
    if (frameDt > 1 / 45) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 150) {
      this.slowFrames = 0;
      const next: Quality | null = this.quality === 'high' ? 'balanced' : this.quality === 'balanced' ? 'performance' : null;
      if (next) { this.setQuality(next); this.onAutoDowngrade?.(next); }
    }
  }
}
