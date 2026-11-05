import * as THREE from 'three';
import { glassTexture, hexTexture } from './Textures';

/**
 * Shared material factory. Materials are cached per colour so hundreds of
 * obstacles share a handful of GPU programs and uniforms.
 */
class MaterialFactory {
  envMap: THREE.Texture | null = null;
  private glass = new Map<number, THREE.MeshPhysicalMaterial>();
  private reinforced = new Map<number, THREE.MeshPhysicalMaterial>();
  private edges = new Map<string, THREE.MeshBasicMaterial>();
  orb!: THREE.MeshPhysicalMaterial;

  setEnv(env: THREE.Texture | null) {
    this.envMap = env;
    const all: THREE.MeshStandardMaterial[] = [...this.glass.values(), ...this.reinforced.values()];
    if (this.orb) all.push(this.orb);
    for (const m of all) { m.envMap = env; m.needsUpdate = true; }
  }

  glassMat(tint: number) {
    let m = this.glass.get(tint);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({
        color: tint, map: glassTexture(), transparent: true, opacity: 0.42,
        roughness: 0.06, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05,
        envMap: this.envMap, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false,
        emissive: tint, emissiveIntensity: 0.12,
      });
      this.glass.set(tint, m);
    }
    return m;
  }

  reinforcedMat(tint: number) {
    let m = this.reinforced.get(tint);
    if (!m) {
      const map = hexTexture().clone();
      map.needsUpdate = true;
      map.repeat.set(1.4, 1.4);
      m = new THREE.MeshPhysicalMaterial({
        color: tint, map, transparent: true, opacity: 0.62,
        roughness: 0.12, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08,
        envMap: this.envMap, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false,
        emissive: tint, emissiveIntensity: 0.2,
      });
      this.reinforced.set(tint, m);
    }
    return m;
  }

  /** Unlit glowing material; intensity > 1 feeds the bloom pass. */
  edge(color: number, intensity = 1.6, opacity = 1) {
    const key = `${color}-${intensity}-${opacity}`;
    let m = this.edges.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), transparent: opacity < 1, opacity, fog: true });
      this.edges.set(key, m);
    }
    return m;
  }

  orbMat() {
    if (!this.orb) {
      this.orb = new THREE.MeshPhysicalMaterial({
        color: 0xf2f6ff, metalness: 0.55, roughness: 0.14, envMap: this.envMap, envMapIntensity: 2.2,
        iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
        clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x9fdfff, emissiveIntensity: 0.25,
      });
    }
    return this.orb;
  }
}

export const materials = new MaterialFactory();
