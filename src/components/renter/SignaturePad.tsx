'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Finger / mouse / stylus signature box (pointer events). Writes a PNG data
 * URL into a hidden input named `name`; the value is empty until something is drawn.
 */
export function SignaturePad({ name, label, hint, clearLabel, invalid }: { name: string; label: string; hint: string; clearLabel: string; invalid?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const [value, setValue] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Fixed backing size so the exported image does not depend on the screen.
    canvas.width = 900;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#163c33';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    event.preventDefault();
    canvasRef.current!.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // a tap leaves a dot
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    event.preventDefault();
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    strokes.current += 1;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // Require a real stroke, not a single accidental touch.
    if (strokes.current >= 8 && canvasRef.current) setValue(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokes.current = 0;
    setValue('');
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <span className="field-label mb-0" id={`${name}-label`}>{label}</span>
        <button type="button" className="btn-plain text-sm underline" onClick={clear}>{clearLabel}</button>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-labelledby={`${name}-label`}
        aria-describedby={`${name}-hint`}
        data-testid="signature-pad"
        className={`mt-1 block aspect-[3/1] w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed bg-white ${invalid ? 'border-danger' : 'border-[#b9c4b8]'}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <p id={`${name}-hint`} className="field-hint">{hint}</p>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
