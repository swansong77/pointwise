'use client';

import { Badge, Panel } from '@/components/ui';
import { CashbackRec, FRESH_LABEL, HEALTH_LABEL, HEALTH_TONE, RankedSite } from '@/lib/cashback';
import { money, shortDate } from '@/lib/format';

function Row({ s }: { s: RankedSite }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="cashback-row">
      <span className="min-w-0 flex-1">
        <span className="font-medium text-slate-900">{s.name}</span> <span className="text-slate-600">{s.label}</span>
        <span className="block text-xs text-slate-600">
          {FRESH_LABEL[s.freshness]}
          {s.holders.length ? ` · ${s.holders.join(', ')} ${s.holders.length === 1 ? 'has' : 'have'} an account` : ' · nobody has joined'}
        </span>
      </span>
      <Badge tone={HEALTH_TONE[s.health]}>{HEALTH_LABEL[s.health]}</Badge>
      <span className="tabular-nums text-slate-700">{s.usable ? `${money(s.expectedCents)} expected` : 'not counted'}</span>
    </li>
  );
}

/**
 * Which cash-back site to use for a purchase: the pick and why, what to do step by step, a better site to consider joining, and every
 * site's rate with how current it is and whether the site is answering. Shown in the shopping plan and on the Cash-back sites page.
 */
export function CashbackCard({ rec, merchant }: { rec: CashbackRec; merchant: string }) {
  const { pick, consider } = rec;
  return (
    <Panel title={`Cash back at ${merchant}`} data-testid="cashback-card">
      {pick ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="cashback-pick">
          <p className="text-sm font-semibold text-emerald-900">
            Use {pick.name}: {pick.label}, about {money(pick.expectedCents)}
          </p>
          <p className="mt-1 text-xs text-emerald-900">
            {rec.haveAccounts ? 'You have an account there.' : 'This is the best rate on file.'} Rate {FRESH_LABEL[pick.freshness]} · {pick.healthNote}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800" data-testid="cashback-steps">
            {rec.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-slate-700" data-testid="cashback-none">
          No cash-back site to recommend for this purchase.
        </p>
      )}
      {consider && (
        <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-slate-800" data-testid="cashback-consider">
          <strong>{consider.name}</strong> ({consider.label}) would return about {money(consider.extraCents)} more, and nobody in your household has an account there.
        </p>
      )}
      {rec.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-900" data-testid="cashback-warnings">
          {rec.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {rec.ranked.length > 0 && (
        <details className="mt-3" open={!pick}>
          <summary className="cursor-pointer text-sm font-medium text-slate-800">All sites with a rate ({rec.ranked.length})</summary>
          <ul className="divide-y divide-slate-100" data-testid="cashback-ranked">
            {rec.ranked.map((s) => (
              <Row key={s.site} s={s} />
            ))}
          </ul>
        </details>
      )}
      {rec.benchmark && (
        <p className="mt-2 text-xs text-slate-600" data-testid="cashback-benchmark">
          {rec.benchmark.source} lists a best rate of {rec.benchmark.bestPercent}% for {merchant} across all sites (read {shortDate(rec.benchmark.observedAt)}).
        </p>
      )}
      {rec.monitorUrl && (
        <p className="mt-3 text-sm">
          <a href={rec.monitorUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-700 underline-offset-2 hover:underline" data-testid="cashback-monitor-link">
            Compare every site for {merchant} on Cashback Monitor
          </a>{' '}
          <span className="text-xs text-slate-600">(opens their page; it also lists sites PointWise does not track)</span>
        </p>
      )}
      <p className="mt-3 text-xs text-slate-600">
        Rates come from what was entered or read from the sites&apos; public pages and may be out of date; check the rate on the site before you buy. PointWise never signs in to a cash-back site.
      </p>
    </Panel>
  );
}
