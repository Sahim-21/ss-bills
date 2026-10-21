"use client";

// Small dependency-free SVG charts following the dataviz mark specs:
// bars ≤ 24px with 4px rounded data-ends, 2px lines, ≥ 8px markers with a surface ring,
// hairline solid gridlines, hover tooltips, and a table view for every chart.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cx } from "./ui";

type Point = { label: string; value: number; sub?: string };

/** Render SVGs at their real pixel width so text stays at its natural size. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Positioned in percent of the chart box, so it tracks the responsive SVG. */
function Tooltip({ xPct, yPct, children }: { xPct: number; yPct: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-charcoal px-3 py-2 text-label-md text-white shadow-level3"
      style={{ left: `${xPct}%`, top: `calc(${yPct}% - 8px)` }}
    >
      {children}
    </div>
  );
}

/** Vertical columns, one series. `highlight` marks the peak in the strong hue. */
export function ColumnChart({
  data,
  height = 240,
  ariaLabel,
  highlightMax = true,
}: {
  data: Point[];
  height?: number;
  ariaLabel: string;
  highlightMax?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(640);
  const padL = 48;
  const padB = 28;
  const padT = 12;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const plotH = height - padB - padT;
  const band = (W - padL) / data.length;
  const barW = Math.min(24, band * 0.6);
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--color-surface-high)" strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="fill-muted text-[11px]">
                {formatINRCompact(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const x = padL + band * i + (band - barW) / 2;
          const y = padT + plotH - h;
          const strong = (highlightMax && i === peak) || hover === i;
          const r = Math.min(4, h);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill={strong ? "var(--color-chart-1)" : "var(--color-primary-fixed-dim)"}
                />
              )}
              <text
                x={padL + band * i + band / 2}
                y={height - 8}
                textAnchor="middle"
                className={cx("text-[11px]", i === peak ? "fill-ink font-bold" : "fill-muted")}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip
          xPct={((padL + band * hover + band / 2) / W) * 100}
          yPct={((padT + plotH - (data[hover].value / max) * plotH) / height) * 100}
        >
          <span className="tnum font-bold">{formatINR(data[hover].value)}</span>
          {data[hover].sub && <span className="ml-2 text-white/70">{data[hover].sub}</span>}
        </Tooltip>
      )}
    </div>
  );
}

/** Line + soft area wash, one series, crosshair tooltip. */
export function LineChart({
  data,
  compare,
  height = 260,
  ariaLabel,
}: {
  data: Point[];
  /** Optional second series drawn as a dashed line (for example the previous period). */
  compare?: Point[];
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(720);
  const padL = 52;
  const padR = 16;
  const padB = 30;
  const padT = 14;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value), ...(compare ?? []).map((d) => d.value)) * 1.05);
  const plotH = height - padB - padT;
  const plotW = W - padL - padR;
  const xAt = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - (v / max) * plotH;
  const path = data.map((d, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(d.value)}`).join(" ");
  const comparePath = compare?.map((d, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(d.value)}`).join(" ");
  const area = `${path} L${xAt(data.length - 1)},${padT + plotH} L${xAt(0)},${padT + plotH} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((x - padL) / plotW) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-surface-high)" strokeWidth={1} />
            <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {formatINRCompact(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--color-chart-1)" opacity={0.1} />
        {comparePath && (
          <path d={comparePath} fill="none" stroke="var(--color-outline)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
        )}
        <path d={path} fill="none" stroke="var(--color-chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) =>
          // always label the last point, and skip a regular label that would collide with it
          i === data.length - 1 || (i % labelEvery === 0 && data.length - 1 - i >= labelEvery) ? (
            <text key={d.label} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
              {d.label}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + plotH} stroke="var(--color-outline)" strokeWidth={1} />
        )}
        {data.map((d, i) =>
          i === data.length - 1 || i === hover ? (
            <circle key={i} cx={xAt(i)} cy={yAt(d.value)} r={5} fill="var(--color-chart-1)" stroke="white" strokeWidth={2} />
          ) : null,
        )}
      </svg>
      {hover !== null && (
        <Tooltip xPct={(xAt(hover) / W) * 100} yPct={(yAt(data[hover].value) / height) * 100}>
          <div className="text-white/70">{data[hover].label}</div>
          <div className="tnum font-bold">{formatINR(data[hover].value)}</div>
          {data[hover].sub && <div className="text-white/70">{data[hover].sub}</div>}
          {compare?.[hover] && <div className="tnum text-white/70">Before: {formatINR(compare[hover].value)}</div>}
        </Tooltip>
      )}
    </div>
  );
}

/** Donut for a part-to-whole of ≤ 3 categories, with a legend that carries labels and values. */
export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string; sub?: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 70;
  const stroke = 22;
  const C = 2 * Math.PI * R;
  const gap = 2; // surface gap between segments
  const lengths = segments.map((s) => (s.value / total) * C);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={`${centerLabel} ${centerValue}`}>
        <g transform="rotate(-90 90 90)">
          {segments.map((s, i) => (
              <circle
                key={s.label}
                cx={90}
                cy={90}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, lengths[i] - gap)} ${C}`}
                strokeDashoffset={-offsets[i]}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
          ))}
        </g>
        <text x={90} y={84} textAnchor="middle" className="fill-muted text-[10px] font-bold uppercase">
          {hover !== null ? segments[hover].label : centerLabel}
        </text>
        <text x={90} y={104} textAnchor="middle" className="tnum fill-ink text-[16px] font-extrabold">
          {hover !== null ? formatINRCompact(segments[hover].value) : centerValue}
        </text>
      </svg>
      <ul className="min-w-[220px] flex-1 space-y-2">
        {segments.map((s, i) => (
          <li
            key={s.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", hover === i ? "bg-surface-high" : "bg-surface-low")}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1">
              <span className="block text-label-lg">{s.label}</span>
              {s.sub && <span className="block text-body-sm text-muted">{s.sub}</span>}
            </span>
            <span className="text-right">
              <span className="tnum block text-price-md">{formatINR(s.value)}</span>
              <span className="tnum block text-body-sm text-muted">{((s.value / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars (best sellers). */
export function RankBars({ rows }: { rows: { label: string; qty: number; value: number; veg?: boolean; lead?: ReactNode }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.qty));
  return (
    <ol className="space-y-4">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="flex items-center gap-3">
            <span className="tnum w-6 text-label-lg text-muted">#{i + 1}</span>
            {r.lead}
            <span className="flex-1 truncate text-label-lg">{r.label}</span>
            <span className="tnum text-body-md text-muted">{r.qty} sold</span>
            <span className="tnum w-24 text-right text-price-md">{formatINR(r.value)}</span>
          </div>
          <div className="ml-9 mt-1.5 h-2 rounded-full bg-surface-container">
            <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(r.qty / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
