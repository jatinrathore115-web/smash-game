import * as THREE from 'three';

export interface SkyColors { top: number; mid: number; bottom: number; sun: number; sunDir: THREE.Vector3 }

/** Large gradient dome with a soft sun glow and slowly drifting light bands. Follows the camera. */
export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  constructor() {
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
      uTime: { value: 0 }, uPulse: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uBottom, uSun, uSunDir; uniform float uTime, uPulse; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.65, h)) : mix(uMid, uBottom, smoothstep(0.0, -0.5, h));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSun * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6);
          float band = sin(d.y * 18.0 + d.x * 3.0 + uTime * 0.08) * 0.5 + 0.5;
          col += uSun * band * 0.025 * (1.0 - abs(h));
          col += (uSun * 0.06) * uPulse * smoothstep(-0.2, 0.3, s);
          col += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding in gradients
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
  set(c: SkyColors) {
    (this.uniforms.uTop.value as THREE.Color).set(c.top);
    (this.uniforms.uMid.value as THREE.Color).set(c.mid);
    (this.uniforms.uBottom.value as THREE.Color).set(c.bottom);
    (this.uniforms.uSun.value as THREE.Color).set(c.sun);
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(c.sunDir).normalize();
  }
  update(camPos: THREE.Vector3, time: number, pulse: number) {
    this.mesh.position.copy(camPos);
    this.uniforms.uTime.value = time;
    this.uniforms.uPulse.value = pulse;
  }
}
