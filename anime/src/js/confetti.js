'use strict';

const Confetti = (() => {
  let canvas, ctx, pieces = [], rafId = null, running = false;
  const COLORS = ['#7c5cff', '#b45cff', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#ffffff'];

  function init() {
    canvas = document.getElementById('confetti');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function burst(x, y, count = 90) {
    if (!canvas) init();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 11;
      pieces.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 9,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
        shape: Math.random() > 0.35 ? 'rect' : 'circle',
      });
    }
    if (!running) {
      running = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  function celebrate() {
    const w = window.innerWidth, h = window.innerHeight;
    burst(w * 0.5, h * 0.34, 130);
    setTimeout(() => burst(w * 0.16, h * 0.42, 80), 220);
    setTimeout(() => burst(w * 0.84, h * 0.42, 80), 400);
    setTimeout(() => burst(w * 0.5, h * 0.28, 60), 650);
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pieces = pieces.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
    for (const p of pieces) {
      p.vy += 0.24;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (pieces.length) {
      rafId = requestAnimationFrame(tick);
    } else {
      running = false;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  return { celebrate, burst };
})();
