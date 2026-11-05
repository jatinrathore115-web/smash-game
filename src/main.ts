import './ui/styles.css';
import { Game } from './core/Game';

function boot() {
  const stage = document.getElementById('stage')!;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    ui.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;font:600 40px sans-serif;color:#2a2142">WebGL is required to play LUMA RIFT.</div>';
    return;
  }
  const game = new Game(stage, canvas, ui);
  (window as unknown as { __game: Game }).__game = game;
}

boot();
