import { useState, useCallback, useEffect, useRef } from "react";

interface AppleCornerPathOptions {
  width: number;
  height: number;
  radius: number;
  smoothing?: number;
}

export function appleCornerPath({ width, height, radius, smoothing = 60 }: AppleCornerPathOptions): string {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  const s = clamp(smoothing, 0, 100) / 100;

  if (!w || !h) return "";
  if (!r) return `M0 0H${w}V${h}H0Z`;

  if (s <= 0.001) {
    const c = r * 0.5522847498307936;
    return `M${r} 0H${w - r}C${w - r + c} 0 ${w} ${r - c} ${w} ${r}V${h - r}C${w} ${h - r + c} ${w - r + c} ${h} ${w - r} ${h}H${r}C${r - c} ${h} 0 ${h - r + c} 0 ${h - r}V${r}C0 ${r - c} ${r - c} 0 ${r} 0Z`;
  }

  const exponent = 2 + s * 3.35;
  const steps = 22;
  const points: [number, number][] = [];

  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + (a1 - a0) * (i / steps);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x = cx + r * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent);
      const y = cy + r * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent);
      points.push([+x.toFixed(3), +y.toFixed(3)]);
    }
  };

  points.push([r, 0], [w - r, 0]);
  corner(w - r, r, -Math.PI / 2, 0);
  points.push([w, h - r]);
  corner(w - r, h - r, 0, Math.PI / 2);
  points.push([r, h]);
  corner(r, h - r, Math.PI / 2, Math.PI);
  points.push([0, r]);
  corner(r, r, Math.PI, Math.PI * 1.5);

  const deduped = points.filter((point, index, all) => {
    if (index === 0) return true;
    const prev = all[index - 1];
    return point[0] !== prev[0] || point[1] !== prev[1];
  });

  return `M${deduped.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

/**
 * useCornerSmoothing — uses a callback ref (not useRef) so it correctly fires
 * when the element is dynamically mounted, per container-callback-ref rule.
 * Guards zero dimensions per container-guard-initial-zero rule: falls back
 * to border-radius CSS until a real measurement is available.
 */
export function useCornerSmoothing<T extends HTMLElement>(radius = 16, smoothing = 60) {
  const [clipPath, setClipPath] = useState<string>("");
  // Persist the observer instance across renders to prevent leaks on unmount
  const observerRef = useRef<ResizeObserver | null>(null);

  const updatePath = (el: T) => {
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Guard: if dimensions are zero, fall back gracefully — don't set clip-path
    if (width === 0 || height === 0) {
      setClipPath("");
      return;
    }

    const d = appleCornerPath({ width, height, radius, smoothing });
    setClipPath(`path("${d}")`);
  };

  // Callback ref — fires reliably on mount and unmount, including dynamic mounts
  const ref = useCallback(
    (node: T | null) => {
      // Disconnect any previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (!node) return;

      // Measure immediately on mount
      updatePath(node);

      // Re-measure on resize
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => updatePath(node));
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [radius, smoothing],
  );

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Build the style object: apply clip-path if measured, otherwise use border-radius fallback
  const style: React.CSSProperties = clipPath
    ? { clipPath, WebkitClipPath: clipPath, borderRadius: 0 }
    : { borderRadius: `${radius}px` };

  return { ref, style };
}
