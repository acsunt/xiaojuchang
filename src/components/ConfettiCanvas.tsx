import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type ConfettiOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ConfettiCanvasHandle = {
  celebrate: (visuals: boolean, sound: boolean, origin?: ConfettiOrigin) => void;
};

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => Math.random() * (b - a) + a;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const COLORS = ['#ff3d8b', '#ff7a3d', '#ffd23f', '#f5a8d0', '#ff9ec7', '#7adfd3', '#a4e84b'];
const RIBBON_COLORS = ['#ff3d8b', '#ffd23f', '#7adfd3', '#ff7a3d'];
const GRAVITY = 0.12;

type PType = 'rect' | 'ribbon' | 'circle' | 'spark';

class Particle {
  alive = false;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  gravity = GRAVITY;
  drag = 0.993;
  life = 1;
  decay = 0.008;
  rot = 0;
  rotSpeed = 0;
  color = '';
  size = 4;
  type: PType = 'rect';
  // ribbon
  length = 0;
  width = 0;
  wavePhase = 0;
  waveAmp = 0;
  waveFreq = 0;
  flipPhase = 0;
  flipAmp = 0;
  flipSpeed = 0;
  // spark
  radius = 1;

  spawn(
    x: number,
    y: number,
    opts: {
      vx: number;
      vy: number;
      gravity?: number;
      drag?: number;
      decay?: number;
      color: string;
      size?: number;
      type?: PType;
      rotSpeed?: number;
    },
  ) {
    this.x = x;
    this.y = y;
    this.vx = opts.vx;
    this.vy = opts.vy;
    this.gravity = opts.gravity ?? GRAVITY;
    this.drag = opts.drag ?? 0.993;
    this.life = 1;
    this.decay = opts.decay ?? 0.008;
    this.rot = Math.random() * TAU;
    this.rotSpeed = opts.rotSpeed ?? rand(-0.18, 0.18);
    this.color = opts.color;
    this.size = opts.size ?? 4;
    this.type = opts.type ?? 'rect';
    this.alive = true;

    if (this.type === 'ribbon') {
      this.length = rand(14, 28);
      this.width = rand(1.8, 3.5);
      this.wavePhase = Math.random() * TAU;
      this.waveAmp = rand(2, 5);
      this.waveFreq = rand(0.06, 0.14);
      this.flipPhase = Math.random() * TAU;
      this.flipAmp = rand(0.6, 1.2);
      this.flipSpeed = rand(0.03, 0.07);
    } else if (this.type === 'spark') {
      this.radius = rand(0.8, 1.4);
      this.gravity = 0.04;
      this.drag = 0.97;
    }
  }

  update(H: number, W: number) {
    if (!this.alive) return;
    this.vy += this.gravity;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.x += this.vx;
    this.y += this.vy;
    this.rot += this.rotSpeed;
    this.life -= this.decay;
    if (this.type === 'ribbon') {
      this.wavePhase += this.waveFreq;
      this.flipPhase += this.flipSpeed;
    }
    if (this.y > H + 80 || this.x < -80 || this.x > W + 80 || this.life <= 0) {
      this.alive = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.alive) return;
    const alpha = clamp(this.life, 0, 1);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = alpha;

    if (this.type === 'rect') {
      ctx.fillStyle = this.color;
      const w = this.size,
        h = this.size * 1.5;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(-w / 2, -h / 2, w, h * 0.3);
    } else if (this.type === 'ribbon') {
      const L = this.length,
        w = this.width;
      const wave = Math.sin(this.wavePhase) * this.waveAmp;
      const flip = Math.sin(this.flipPhase) * this.flipAmp;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(-L / 2, -w / 2);
      ctx.bezierCurveTo(
        -L / 4,
        -w / 2 + wave * 2,
        L / 4,
        w / 2 + wave * 2 - flip * w * 1.5,
        L / 2,
        w / 2,
      );
      ctx.lineTo(L / 2 + 2, -w / 2 + 2);
      ctx.bezierCurveTo(
        L / 4,
        -w / 2 + wave * 2 - flip * w * 1.5,
        -L / 4,
        w / 2 + wave * 2,
        -L / 2,
        w / 2,
      );
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = w * 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 2, 0);
      ctx.bezierCurveTo(-L / 4, wave * 1.2, L / 4, wave * 1.2 - flip * w * 1.2, L / 2 - 2, 0);
      ctx.stroke();
    } else if (this.type === 'circle') {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, TAU);
      ctx.fill();
    } else if (this.type === 'spark') {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius * 4);
      grad.addColorStop(0, this.color);
      grad.addColorStop(0.4, this.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

const POOL_SIZE = 600;

export const ConfettiCanvas = forwardRef<ConfettiCanvasHandle>(function ConfettiCanvas(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ W: 0, H: 0, DPR: 1 });
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      celebrate(visuals: boolean, sound: boolean, origin?: ConfettiOrigin) {
        if (sound) {
          ensureAudio();
          playLaunchSound();
        }
        if (!visuals) return;
        const { W, H } = sizeRef.current;
        if (origin) {
          // 从卡片位置两侧喷射，礼花覆盖标题到正文区域
          const burstX1 = Math.max(20, origin.x);
          const burstY = origin.y + origin.height * 0.35;
          const burstX2 = Math.min(W - 20, origin.x + origin.width);
          sideBurstAt(burstX1, burstY, 'left');
          sideBurstAt(burstX2, burstY, 'right');
          setTimeout(() => {
            sideBurstAt(burstX1, burstY, 'left');
            sideBurstAt(burstX2, burstY, 'right');
          }, 160);
          setTimeout(() => {
            sideBurstAt(burstX1, burstY, 'left');
            sideBurstAt(burstX2, burstY, 'right');
          }, 340);
          // 卡片上方点缀小烟花
          for (let i = 0; i < 3; i++) {
            const fx = rand(origin.x + origin.width * 0.15, origin.x + origin.width * 0.85);
            const fy = rand(origin.y - H * 0.05, origin.y + origin.height * 0.3);
            setTimeout(() => fireworkAt(fx, fy), rand(150, 550));
          }
        } else {
          sideBurst('left');
          sideBurst('right');
          setTimeout(() => {
            sideBurst('left');
            sideBurst('right');
          }, 160);
          setTimeout(() => {
            sideBurst('left');
            sideBurst('right');
          }, 340);
          for (let i = 0; i < 3; i++) {
            const fx = rand(W * 0.25, W * 0.75);
            const fy = rand(H * 0.18, H * 0.4);
            setTimeout(() => fireworkAt(fx, fy), rand(150, 550));
          }
        }
      },
    }),
    // fireworkAt/sideBurst/sideBurstAt 只读取 ref（sizeRef/poolRef 引用稳定），
    // 不依赖组件状态或 props，无需放进依赖数组；否则每次渲染都会重建 handle。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function ensureAudio() {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
      } catch {
        /* ignore */
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
  }

  function playLaunchSound() {
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2800, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    filter.Q.value = 0.6;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(t);

    const osc = audioCtx.createOscillator();
    const og = audioCtx.createGain();
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.16);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(og);
    og.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.25);

    for (let i = 0; i < 2; i++) {
      const ot = t + 0.1 + i * 0.1;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(pick([1318, 1568, 1976]), ot);
      g.gain.setValueAtTime(0.0001, ot);
      g.gain.exponentialRampToValueAtTime(0.06, ot + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ot + 0.2);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(ot);
      o.stop(ot + 0.22);
    }
  }

  function getParticle(): Particle {
    const pool = poolRef.current;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].alive) return pool[i];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function sideBurst(side: 'left' | 'right') {
    const { W, H } = sizeRef.current;
    const isLeft = side === 'left';
    const x = isLeft ? 0 : W;
    const y = H * 0.58;
    const cx = W * 0.5;
    const cy = H * 0.28;
    const count = Math.floor(clamp(W * 0.05, 28, 60));
    const baseAngle = Math.atan2(cy - y, cx - x);
    const spread = Math.PI * 0.16;
    for (let i = 0; i < count; i++) {
      const p = getParticle();
      const angle = baseAngle + rand(-spread, spread);
      const speed = rand(6, 12);
      const r = Math.random();
      const type: PType = r < 0.45 ? 'ribbon' : r < 0.6 ? 'spark' : r < 0.8 ? 'circle' : 'rect';
      p.spawn(x, y + rand(-20, 20), {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: type === 'ribbon' ? pick(RIBBON_COLORS) : pick(COLORS),
        size: type === 'ribbon' ? rand(1.5, 3) : rand(3, 6),
        type,
        decay: rand(0.006, 0.01),
        rotSpeed: rand(-0.15, 0.15),
      });
    }
  }

  // 从指定坐标向卡片中央喷射
  function sideBurstAt(x: number, y: number, side: 'left' | 'right') {
    const { W } = sizeRef.current;
    const isLeft = side === 'left';
    const cx = isLeft ? x + 120 : x - 120;
    const cy = y - 40;
    const count = Math.floor(clamp(W * 0.04, 22, 48));
    const baseAngle = Math.atan2(cy - y, cx - x);
    const spread = Math.PI * 0.14;
    for (let i = 0; i < count; i++) {
      const p = getParticle();
      const angle = baseAngle + rand(-spread, spread);
      const speed = rand(5, 10);
      const r = Math.random();
      const type: PType = r < 0.45 ? 'ribbon' : r < 0.6 ? 'spark' : r < 0.8 ? 'circle' : 'rect';
      p.spawn(x, y + rand(-15, 15), {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: type === 'ribbon' ? pick(RIBBON_COLORS) : pick(COLORS),
        size: type === 'ribbon' ? rand(1.5, 3) : rand(3, 6),
        type,
        decay: rand(0.006, 0.01),
        rotSpeed: rand(-0.15, 0.15),
      });
    }
  }

  function fireworkAt(x: number, y: number) {
    const n = Math.floor(rand(18, 32));
    for (let i = 0; i < n; i++) {
      const p = getParticle();
      const angle = rand(0, TAU);
      const speed = rand(1.5, 5);
      p.spawn(x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8,
        color: pick(COLORS),
        size: rand(2, 4),
        type: Math.random() < 0.65 ? 'spark' : 'circle',
        decay: rand(0.015, 0.025),
        rotSpeed: 0,
        gravity: 0.06,
        drag: 0.96,
      });
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 初始化粒子池
    if (poolRef.current.length === 0) {
      poolRef.current = Array.from({ length: POOL_SIZE }, () => new Particle());
    }

    const resize = () => {
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth;
      const H = window.innerHeight;
      sizeRef.current = { W, H, DPR };
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      const { W, H } = sizeRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const pool = poolRef.current;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        p.update(H, W);
        p.draw(ctx);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
});
