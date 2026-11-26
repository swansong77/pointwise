import clsx from 'clsx';
import { arcPath, gaugeFraction, stepPath, timelineSteps } from '@/lib/portfolio';
import type { Five24TimelinePoint } from '@/lib/portfolio-types';
import { shortDate } from '@/lib/format';

/** Half-circle 5/24 gauge (inline SVG — no chart library, CSP-friendly). */
export function Five24Gauge({ count, label, limit = 5 }: { count: number; label: string; limit?: number }) {
  const over = count >= limit;
  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-[220px]" role="img" aria-label={`5/24 status ${label}`} data-testid="five24-gauge">
      <path d={arcPath(1)} fill="none" stroke="#e2e8f0" strokeWidth="16" strokeLinecap="round" />
      {count > 0 && <path d={arcPath(gaugeFraction(count))} fill="none" stroke={over ? '#dc2626' : '#059669'} strokeWidth="16" strokeLinecap="round" />}
      <text x="100" y="92" textAnchor="middle" className="fill-slate-900" fontSize="30" fontWeight="700">
        {label}
      </text>
      <text x="100" y="112" textAnchor="middle" className="fill-slate-500" fontSize="11">
        {over ? 'Over the limit' : `${limit - count} slot${limit - count === 1 ? '' : 's'} left`}
      </text>
    </svg>
  );
}

/** Step chart of the projected 5/24 count, with an accessible list alternative. */
export function Five24TimelineChart({ points, title }: { points: Five24TimelinePoint[]; title: string }) {
  const W = 600;
  const H = 140;
  const steps = timelineSteps(points, W, H);
  if (points.length <= 1) return <p className="text-sm text-slate-500">No cards drop off in the projection window.</p>;
  return (
    <figure>
      <svg viewBox={`-10 -10 ${W + 20} ${H + 40}`} className="w-full" role="img" aria-label={title}>
        {[0, 2, 4, 6].map((c) => (
          <g key={c}>
            <line x1="0" x2={W} y1={H - (c / 6) * H} y2={H - (c / 6) * H} stroke="#f1f5f9" />
            <text x={-6} y={H - (c / 6) * H + 4} textAnchor="end" fontSize="10" className="fill-slate-500">
              {c}
            </text>
          </g>
        ))}
        <line x1="0" x2={W} y1={H - (5 / 6) * H} y2={H - (5 / 6) * H} stroke="#fca5a5" strokeDasharray="4 4" />
        <path d={stepPath(steps, W)} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
        {steps.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r="4" className="fill-brand-600" />
            <text x={s.x} y={H + 22} textAnchor={i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle'} fontSize="10" className="fill-slate-500">
              {shortDate(s.date)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        <ul>
          {points.map((p, i) => (
            <li key={i}>
              {shortDate(p.date)}: {p.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Horizontal bars for comparing values (negative values in red). */
export function BarList({ items, format }: { items: Array<{ label: string; value: number; hint?: string }>; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-0.5 flex justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className={clsx('font-medium tabular-nums', i.value < 0 ? 'text-red-700' : 'text-slate-900')}>{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100" aria-hidden>
            <div className={clsx('h-2 rounded-full', i.value < 0 ? 'bg-red-400' : 'bg-emerald-500')} style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} />
          </div>
          {i.hint && <p className="mt-0.5 text-xs text-slate-500">{i.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export function StatTiles({ items, testId }: { items: Array<[string, string, string?]>; testId?: string }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid={testId}>
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Accessible segmented control (buttons with aria-pressed). */
export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<[T, string]>; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={clsx('rounded-lg px-3 py-1.5 text-sm', value === v ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
