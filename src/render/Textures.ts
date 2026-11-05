import * as THREE from 'three';

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let cache: Record<string, THREE.Texture> = {};
const memo = (key: string, make: () => THREE.Texture) => cache[key] || (cache[key] = make());

/** Soft round particle. */
export const dotTexture = () => memo('dot', () => canvasTex(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
}));

/** Four-point star glint used for refractive sparkles. */
export const glintTexture = () => memo('glint', () => canvasTex(64, (g, s) => {
  const c = s / 2;
  const r = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[s, 3], [3, s]]) {
    const lg = g.createLinearGradient(c - w / 2, c - h / 2, c + w / 2, c + h / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(c - w / 2, c - h / 2, w, h);
  }
}));

/** Thin luminous ring for impact pulses and charge feedback. */
export const ringTexture = () => memo('ring', () => canvasTex(128, (g, s) => {
  const c = s / 2;
  const r = g.createRadialGradient(c, c, c * 0.55, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  r.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
}));

/** Diagonal light streaks that make glass read as glass from any background. */
export const glassTexture = () => memo('glass', () => {
  const t = canvasTex(256, (g, s) => {
    g.fillStyle = 'rgb(200,210,225)'; g.fillRect(0, 0, s, s);
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.3)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    g.save(); g.translate(s / 2, s / 2); g.rotate(-Math.PI / 4);
    const bands = [[-70, 26, 0.85], [-30, 8, 0.6], [40, 14, 0.5], [68, 4, 0.7]];
    for (const [x, w, a] of bands) {
      const lg = g.createLinearGradient(x - w, 0, x + w, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(x - w, -s, w * 2, s * 2);
    }
    g.restore();
  });
  return t;
});

/** Hexagonal lattice: shape cue for reinforced glass (readable without colour). */
export const hexTexture = () => memo('hex', () => {
  const t = canvasTex(256, (g, s) => {
    g.fillStyle = 'rgb(205,200,235)'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
    const r = s / 8, hh = Math.sqrt(3) * r;
    for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
      const cx = col * r * 3 + ((row & 1) ? r * 1.5 : 0), cy = row * hh / 2;
      g.beginPath();
      for (let i = 0; i <= 6; i++) { const a = Math.PI / 3 * i; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      g.stroke();
    }
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, 'rgba(255,255,255,0.4)'); grad.addColorStop(0.5, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.25)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

/** Very soft cloud puff for distant atmosphere. */
export const cloudTexture = () => memo('cloud', () => canvasTex(256, (g, s) => {
  for (let i = 0; i < 14; i++) {
    const x = s * (0.2 + Math.random() * 0.6), y = s * (0.35 + Math.random() * 0.3), rr = s * (0.12 + Math.random() * 0.18);
    const r = g.createRadialGradient(x, y, 0, x, y, rr);
    r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  }
}));
