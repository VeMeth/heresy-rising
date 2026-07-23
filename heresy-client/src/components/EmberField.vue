<template>
  <canvas ref="canvas" class="ember-canvas" aria-hidden="true"></canvas>
</template>

<script setup>
// Ambient ember/ash field: gold motes and the occasional oxblood spark
// drifting upward like a candle-lit war room. Rendered above the UI
// (pointer-events: none, screen blend) so it reads as room atmosphere.
// Fully disabled under prefers-reduced-motion; pauses when the tab hides.
import { onBeforeUnmount, onMounted, ref } from 'vue';

const canvas = ref(null);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let ctx = null;
let raf = 0;
let running = false;
let w = 0, h = 0, dpr = 1, last = 0;
let embers = [];
let glows = [];

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.value.width = Math.floor(w * dpr);
  canvas.value.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawnEmber(p, initial) {
  p.x = Math.random() * w;
  p.y = initial ? Math.random() * h : h + 8 + Math.random() * 20;
  p.r = 0.7 + Math.random() * 1.6;
  p.vy = 10 + Math.random() * 26;
  p.sway = 10 + Math.random() * 22;
  p.freq = 0.3 + Math.random() * 0.7;
  p.phase = Math.random() * Math.PI * 2;
  p.tw = 0.5 + Math.random() * 1.6;
  p.red = Math.random() < 0.14;
  p.base = 0.22 + Math.random() * 0.42;
}

function spawnGlow(g, initial) {
  g.x = Math.random() * w;
  g.y = initial ? Math.random() * h : h + 40;
  g.r = 24 + Math.random() * 42;
  g.vy = 4 + Math.random() * 7;
  g.sway = 24 + Math.random() * 30;
  g.freq = 0.12 + Math.random() * 0.2;
  g.phase = Math.random() * Math.PI * 2;
  g.alpha = 0.025 + Math.random() * 0.03;
}

function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  const time = t / 1000;
  ctx.clearRect(0, 0, w, h);

  // Large, very faint ember-glow blooms behind the sparks.
  for (const g of glows) {
    g.y -= g.vy * dt;
    if (g.y < -g.r - 20) spawnGlow(g, false);
    const x = g.x + Math.sin(time * g.freq + g.phase) * g.sway;
    const grad = ctx.createRadialGradient(x, g.y, 0, x, g.y, g.r);
    grad.addColorStop(0, `rgba(223, 194, 124, ${g.alpha})`);
    grad.addColorStop(1, 'rgba(223, 194, 124, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, g.y, g.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The embers themselves: rise, sway, twinkle, respawn at the bottom.
  for (const p of embers) {
    p.y -= p.vy * dt;
    if (p.y < -12) spawnEmber(p, false);
    const x = p.x + Math.sin(time * p.freq + p.phase) * p.sway;
    const a = p.base * (0.55 + 0.45 * Math.sin(time * p.tw * 2 + p.phase));
    ctx.fillStyle = p.red
      ? `rgba(196, 90, 70, ${a})`
      : `rgba(223, 194, 124, ${a})`;
    ctx.beginPath();
    ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  raf = requestAnimationFrame(frame);
}

function start() {
  if (running || !ctx) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
}

function onVisibility() {
  if (document.hidden) stop();
  else start();
}

onMounted(() => {
  if (reduced.matches) return;
  ctx = canvas.value.getContext('2d');
  resize();
  const emberCount = Math.max(24, Math.min(48, Math.floor(w / 30)));
  embers = Array.from({ length: emberCount }, () => {
    const p = {};
    spawnEmber(p, true);
    return p;
  });
  glows = Array.from({ length: 5 }, () => {
    const g = {};
    spawnGlow(g, true);
    return g;
  });
  start();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  stop();
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>
