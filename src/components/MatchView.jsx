import { useEffect, useRef } from 'react';
import { renderMatch, interpolateState } from '../render/pitchRenderer.js';
import { PITCH } from '../engine/pitch.js';
import { DT } from '../engine/constants.js';

const STEP_MS = DT * 1000;
const MAX_FRAME_MS = 250; // tab kembali aktif setelah lama: jangan kejar ketinggalan
const MAX_STEPS_PER_FRAME = 40; // pengaman agar satu frame tidak macet
const ASPECT = (PITCH.width + 8) / (PITCH.length + 8);

// Loop permainan. Penggambaran dilakukan langsung ke canvas di setiap
// frame, bukan lewat render ulang React (prinsip arsitektur no. 3).
export default function MatchView({ simulation, running, speed, onTick }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Nilai terbaru dibaca loop lewat ref, supaya loop tidak perlu dibuat ulang.
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const onTickRef = useRef(onTick);
  runningRef.current = running;
  speedRef.current = speed;
  onTickRef.current = onTick;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !simulation) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const size = { width: 0, height: 0 };

    function resize() {
      const width = container.clientWidth;
      const height = Math.round(width * ASPECT);
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size.width = width;
      size.height = height;
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let previous = simulation.getState();
    let current = previous;
    let accumulator = 0;
    let lastTime = performance.now();
    let frameId = 0;

    function frame(now) {
      const elapsed = Math.min(MAX_FRAME_MS, now - lastTime);
      lastTime = now;

      if (runningRef.current) {
        accumulator += elapsed * speedRef.current;
        let steps = 0;
        while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
          previous = current;
          current = simulation.step();
          accumulator -= STEP_MS;
          steps += 1;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        if (steps > 0) onTickRef.current?.(current.tick);
      }

      if (size.width > 0) {
        const alpha = runningRef.current ? accumulator / STEP_MS : 1;
        renderMatch(ctx, interpolateState(previous, current, alpha), size.width, size.height);
      }

      frameId = requestAnimationFrame(frame);
    }

    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [simulation]);

  return (
    <div ref={containerRef} className="match-view">
      <canvas ref={canvasRef} />
    </div>
  );
}
