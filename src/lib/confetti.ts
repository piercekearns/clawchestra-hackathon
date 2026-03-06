import { useCallback, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  isCircle: boolean;
  opacity: number;
}

const COLORS = [
  '#DFFF00', // Clawchestra yellow-green
  '#FF6B6B', // coral
  '#4ECDC4', // teal
  '#45B7D1', // sky
  '#F7DC6F', // gold
  '#BB8FCE', // lavender
  '#FF8C42', // orange
  '#98D8C8', // mint
];

const DURATION = 1300;
const PARTICLE_COUNT = 50;
const FADE_START = DURATION - 400;
const GRAVITY = 0.12;

function createParticle(originX: number, originY: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 3 + Math.random() * 6;
  const isCircle = Math.random() > 0.6;
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: -Math.abs(Math.sin(angle) * speed) - 2 - Math.random() * 4,
    w: isCircle ? 6 + Math.random() * 4 : 5 + Math.random() * 8,
    h: isCircle ? 0 : 3 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 12,
    isCircle,
    opacity: 1,
  };
}

export function triggerConfetti(origin: { x: number; y: number }) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle(origin.x, origin.y));
  }

  const start = performance.now();

  function animate(now: number) {
    const elapsed = now - start;
    if (elapsed >= DURATION) {
      canvas.remove();
      return;
    }

    ctx!.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += GRAVITY;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;

      if (elapsed > FADE_START) {
        p.opacity = 1 - (elapsed - FADE_START) / (DURATION - FADE_START);
      }

      ctx!.save();
      ctx!.globalAlpha = p.opacity;
      ctx!.translate(p.x, p.y);
      ctx!.rotate((p.rotation * Math.PI) / 180);

      if (p.isCircle) {
        ctx!.beginPath();
        ctx!.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx!.fillStyle = p.color;
        ctx!.fill();
      } else {
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }

      ctx!.restore();
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

export function useConfetti() {
  const lastTrigger = useRef(0);

  const trigger = useCallback((origin: { x: number; y: number }) => {
    const now = Date.now();
    if (now - lastTrigger.current < 200) return;
    lastTrigger.current = now;
    triggerConfetti(origin);
  }, []);

  return { trigger };
}
