import { useEffect, useRef } from 'react';
import { renderMatch } from '../render/pitchRenderer.js';
import { PITCH } from '../engine/pitch.js';

// Komponen ini hanya menyiapkan canvas. Penggambaran dilakukan langsung
// ke canvas, bukan lewat render ulang React (prinsip arsitektur no. 3).
export default function MatchView({ state }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    function draw() {
      const width = container.clientWidth;
      const height = Math.round(width * ((PITCH.width + 8) / (PITCH.length + 8)));
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderMatch(ctx, stateRef.current, width, height);
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [state]);

  return (
    <div ref={containerRef} className="match-view">
      <canvas ref={canvasRef} />
    </div>
  );
}
