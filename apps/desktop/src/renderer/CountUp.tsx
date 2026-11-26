import { useEffect, useState } from 'react';
/** A number that counts up once when it first appears (700 ms, ease-out). Shows the final value at once when the system asks for reduced motion. */
export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value <= 0) { setN(value); return; }
    let raf = 0; const t0 = performance.now(); const D = 700;
    const step = (t: number) => { const p = Math.min(1, (t - t0) / D); setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}
