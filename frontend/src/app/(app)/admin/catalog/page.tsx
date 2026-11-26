'use client';

import { BrandLogo } from '@/components/brand-logo';
import { useState } from 'react';
import { BarList, StatTiles, Tabs } from '@/components/charts';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery, useCardSearch } from '@/lib/queries';
import { EVIDENCE_FROM, formatFieldValue, ResearchFact, ResearchReward, verificationTone } from '@/lib/catalog';

type Section = 'review' | 'research' | 'coverage' | 'sources' | 'offers' | 'partners';

interface Proposal {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  evidence: string;
  confidence: number;
  method: string;
  status: string;
  createdAt: string;
  card: { name: string; slug: string };
  source: { url: string } | null;
}
interface Source {
  id: string;
  url: string;
  active: boolean;
  lastFetchedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  failureCount: number;
  card: { name: string; slug: string };
  _count: { proposals: number };
}
interface WelcomeBonus {
  card: string;
  slug: string;
  issuer: string;
  bonusType: string | null;
  bonusAmount: number | null;
  minSpendCents: number | null;
  spendMonths: number | null;
  annualFeeCents: number;
  valuationCents: number | null;
  median24mCents: number | null;
  elevated: boolean;
  since: string;
}
interface History {
  card: { name: string; slug: string };
  timeline: string;
  versions: Array<{
    id: string;
    bonusAmount: number | null;
    valuationCents: number | null;
    annualFeeCents: number;
    validFrom: string;
    validTo: string | null;
    elevated: boolean;
    source: string;
    changeNote: string | null;
  }>;
}

const FIELD_LABEL: Record<string, string> = {
  annualFeeCents: 'Annual fee',
  bonusType: 'Bonus type',
  bonusAmount: 'Welcome bonus',
  bonusSpendCents: 'Bonus spend requirement',
  bonusMonths: 'Bonus spend window (months)',
  foreignTxFee: 'Foreign transaction fee',
  authorizedUserFeeCents: 'Authorized-user fee',
  offerExpiresAt: 'Offer expires',
};

export default function AdminCatalogPage() {
  const [section, setSection] = useState<Section>('review');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Card data"
        subtitle="Issuer page sources, AI-extracted changes awaiting review, and welcome-offer history. Nothing changes in the catalog until an admin approves it."
      />
      <Tabs<Section>
        label="Section"
        value={section}
        onChange={setSection}
        options={[
          ['review', 'Review changes'],
          ['research', 'Research'],
          ['coverage', 'Coverage'],
          ['sources', 'Sources'],
          ['offers', 'Welcome offers'],
          ['partners', 'Transfer partners'],
        ]}
      />
      {section === 'review' && <Review />}
      {section === 'research' && <Research />}
      {section === 'coverage' && <Coverage />}
      {section === 'sources' && <Sources />}
      {section === 'offers' && <Offers />}
      {section === 'partners' && <Partners />}
    </div>
  );
}

function Review() {
  const q = useAuthedQuery<Proposal[]>(['admin', 'proposals'], '/admin/card-proposals?status=PENDING');
  const keys = [
    ['admin', 'proposals'],
    ['admin', 'offers'],
  ] as const;
  const decide = useApiMutation<{
    id: string;
    approve: boolean;
    value?: unknown;
  }>(
    ({ id, approve, value }) => ({
      path: `/admin/card-proposals/${id}/${approve ? 'approve' : 'reject'}`,
      method: 'POST',
      body: approve ? (value === undefined ? {} : { value }) : undefined,
    }),
    keys,
  );
  const [edit, setEdit] = useState<Record<string, string>>({});
  if (!q.data) return <Spinner />;
  if (!q.data.length) return <EmptyState title="No changes waiting for review" />;
  const parse = (p: Proposal, raw: string): unknown => {
    if (p.field.endsWith('Cents')) return Math.round(Number(raw.replace(/[$,]/g, '')) * 100);
    if (p.field === 'foreignTxFee') return /^(y|yes|true)$/i.test(raw);
    if (['bonusAmount', 'bonusMonths'].includes(p.field)) return Number(raw.replace(/,/g, ''));
    return raw;
  };
  return (
    <Panel title={`Waiting for review (${q.data.length})`} data-testid="proposals">
      <ul className="divide-y divide-slate-100">
        {q.data.map((p) => (
          <li key={p.id} className="space-y-2 py-4 text-sm" data-testid="proposal">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.card.name}</span>
              <span className="text-slate-600">· {FIELD_LABEL[p.field] ?? p.field}:</span>
              <span className="text-slate-500 line-through">{formatFieldValue(p.field, p.oldValue)}</span>
              <span aria-hidden>→</span>
              <span className="font-semibold">{formatFieldValue(p.field, p.newValue)}</span>
              <Badge tone={p.confidence >= 0.8 ? 'green' : p.confidence >= 0.6 ? 'amber' : 'red'}>
                {Math.round(p.confidence * 100)}% · {p.method}
              </Badge>
            </div>
            <blockquote className="border-l-2 border-slate-200 pl-3 text-xs text-slate-600">“{p.evidence}”</blockquote>
            {p.source && <p className="truncate text-xs text-slate-500">Source: {p.source.url}</p>}
            <div className="flex flex-wrap items-end gap-2">
              <Button
                onClick={() => decide.mutate({ id: p.id, approve: true })}
                loading={decide.isPending && decide.variables?.id === p.id && decide.variables.approve && decide.variables.value === undefined}
              >
                Approve
              </Button>
              <Button variant="ghost" onClick={() => decide.mutate({ id: p.id, approve: false })}>
                Reject
              </Button>
              <label htmlFor={`edit-${p.id}`} className="sr-only">
                Corrected value for {FIELD_LABEL[p.field] ?? p.field}
              </label>
              <Input id={`edit-${p.id}`} className="w-40" placeholder="Corrected value" value={edit[p.id] ?? ''} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} />
              <Button
                variant="secondary"
                disabled={!edit[p.id]}
                onClick={() =>
                  decide.mutate({
                    id: p.id,
                    approve: true,
                    value: parse(p, edit[p.id]),
                  })
                }
              >
                Approve with correction
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText error={decide.error} />
    </Panel>
  );
}

interface ResearchStatus {
  available: boolean;
  models: string[];
  leadDomains: string[];
  note: string | null;
}
interface ResearchRun {
  id: string;
  kind: 'DISCOVER' | 'VERIFY' | 'NEWS';
  issuer: string | null;
  useLeads: boolean;
  focus: string | null;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  model: string | null;
  searches: number;
  fetches: number;
  inputTokens: number;
  outputTokens: number;
  candidates: number;
  notes: string | null;
  error: string | null;
  createdAt: string;
  card: { name: string; slug: string } | null;
  _count: { results: number };
}
interface Candidate {
  id: string;
  issuerName: string;
  name: string;
  network: string | null;
  type: string;
  annualFeeCents: number | null;
  productUrl: string;
  verification: string;
  evidenceFrom: string;
  verifiedFacts: number;
  totalFacts: number;
  matchedCardId: string | null;
  data: {
    rewardsProgram: string | null;
    facts: ResearchFact[];
    rewards: ResearchReward[];
    features: Array<{ text: string; evidence: string; verified: boolean }>;
    leads?: Array<{ url: string; title: string }>;
  };
  run: { kind: string; issuer: string | null; model: string | null };
}

const RUN_TONE: Record<ResearchRun['status'], 'slate' | 'amber' | 'green' | 'red'> = { QUEUED: 'slate', RUNNING: 'amber', DONE: 'green', FAILED: 'red' };

function Research() {
  const status = useAuthedQuery<ResearchStatus>(['admin', 'research-status'], '/admin/card-research/status');
  const runs = useAuthedQuery<ResearchRun[]>(['admin', 'research-runs'], '/admin/card-research', { refetchInterval: 10_000 });
  const [kind, setKind] = useState<'DISCOVER' | 'VERIFY' | 'NEWS'>('DISCOVER');
  const [useLeads, setUseLeads] = useState(true);
  const [issuer, setIssuer] = useState('');
  const [focus, setFocus] = useState('');
  const [limit, setLimit] = useState('10');
  const [cardQ, setCardQ] = useState('');
  const [cardId, setCardId] = useState('');
  const cards = useCardSearch(cardQ);
  const keys = [
    ['admin', 'research-runs'],
    ['admin', 'candidates'],
  ] as const;
  const kick = useApiMutation<void>(() => ({ path: '/admin/jobs/research-cards', method: 'POST' }), keys);
  const start = useApiMutation<Record<string, unknown>>((body) => ({ path: '/admin/card-research', method: 'POST', body }), keys);
  const verifyAll = useApiMutation<void>(() => ({ path: '/admin/card-research/verify-unverified', method: 'POST', body: {} }), keys);
  const submit = () =>
    start.mutate(
      kind === 'VERIFY'
        ? { kind, cardId, useLeads }
        : { kind, issuer: issuer.trim() || undefined, focus: focus || undefined, limit: Number(limit), ...(kind === 'DISCOVER' && { useLeads }) },
      { onSuccess: () => kick.mutate() },
    );

  return (
    <div className="space-y-6">
      <Panel title="Research cards on issuer websites" data-testid="research-start">
        <p className="mb-4 text-sm text-slate-600">
          A Claude agent searches and reads the issuer&apos;s own site (allow-listed issuer domains only), then PointWise checks every quoted fact against the product page. Nothing
          is published until you approve it below. Only public product information is sent to the model — never user data.
        </p>
        {status.data && !status.data.available && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
            {status.data.note}
          </p>
        )}
        {status.data?.available && <p className="mb-4 text-xs text-slate-500">Model: {status.data.models.join(' → ')} · web search is billed per search by the provider.</p>}
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Task" htmlFor="research-kind">
            <Select id="research-kind" value={kind} onChange={(e) => setKind(e.target.value as 'DISCOVER' | 'VERIFY' | 'NEWS')}>
              <option value="DISCOVER">Find an issuer&apos;s cards</option>
              <option value="VERIFY">Verify one catalog card</option>
              <option value="NEWS">Scan card news for new cards &amp; offers</option>
            </Select>
          </Field>
          {kind !== 'VERIFY' ? (
            <>
              <Field label={kind === 'NEWS' ? 'Issuer (optional)' : 'Issuer'} htmlFor="research-issuer">
                <Input id="research-issuer" placeholder="e.g. Chase" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
              </Field>
              <Field label="Focus (optional)" htmlFor="research-focus">
                <Input id="research-focus" placeholder="e.g. travel cards" value={focus} onChange={(e) => setFocus(e.target.value)} />
              </Field>
              <Field label="Max cards" htmlFor="research-limit">
                <Input id="research-limit" type="number" min={1} max={25} value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Find card" htmlFor="research-card-q">
                <Input id="research-card-q" placeholder="Search the catalog" value={cardQ} onChange={(e) => setCardQ(e.target.value)} />
              </Field>
              <Field label="Card" htmlFor="research-card">
                <Select id="research-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  <option value="">Choose…</option>
                  {cards.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
        {!!status.data?.leadDomains.length && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={kind === 'NEWS' || useLeads} disabled={kind === 'NEWS'} onChange={(e) => setUseLeads(e.target.checked)} />
            <span>
              Use card news sites as leads ({status.data.leadDomains.join(', ')}). They only point the agent to cards and offers; every fact is still quoted from the issuer&apos;s
              page, and only their links are kept.
            </span>
          </label>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={submit}
            disabled={!status.data?.available || (kind === 'DISCOVER' ? issuer.trim().length < 2 : kind === 'VERIFY' ? !cardId : false)}
            loading={start.isPending}
          >
            Start research
          </Button>
          <Button
            variant="secondary"
            disabled={!status.data?.available}
            loading={verifyAll.isPending}
            onClick={() => verifyAll.mutate(undefined, { onSuccess: () => kick.mutate() })}
          >
            Verify unverified cards (up to 20)
          </Button>
        </div>
        <ErrorText error={start.error ?? verifyAll.error} />
      </Panel>

      <Panel title="Research runs" data-testid="research-runs">
        {!runs.data ? (
          <Spinner />
        ) : !runs.data.length ? (
          <EmptyState title="No research runs yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {runs.data.map((r) => (
              <li key={r.id} className="space-y-1 py-3" data-testid="research-run">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={RUN_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                  <span className="font-medium">
                    {r.kind === 'VERIFY'
                      ? `Verify ${r.card?.name ?? 'card'}`
                      : r.kind === 'NEWS'
                        ? `Card news scan${r.issuer ? ` · ${r.issuer}` : ''}${r.focus ? ` (${r.focus})` : ''}`
                        : `Find ${r.issuer} cards${r.focus ? ` (${r.focus})` : ''}`}
                    {r.useLeads && ' · with leads'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {shortDate(r.createdAt)}
                    {r.model && ` · ${r.model}`} · {r.searches} searches · {r.fetches} pages · {(r.inputTokens + r.outputTokens).toLocaleString('en-US')} tokens · {r.candidates}{' '}
                    found · {r._count.results} to review
                  </span>
                </div>
                {r.error && <p className="text-xs text-red-700">{r.error}</p>}
                {r.notes && <p className="whitespace-pre-line text-xs text-slate-500">{r.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Candidates />
    </div>
  );
}

function Candidates() {
  const q = useAuthedQuery<Candidate[]>(['admin', 'candidates'], '/admin/card-candidates?status=PENDING', { refetchInterval: 15_000 });
  const [opts, setOpts] = useState<Record<string, { applyRewards?: boolean; acceptUnverified?: boolean; centsPerPoint?: string }>>({});
  const keys = [
    ['admin', 'candidates'],
    ['admin', 'research-runs'],
    ['admin', 'proposals'],
    ['admin', 'sources'],
  ] as const;
  const decide = useApiMutation<{ id: string; approve: boolean; body?: unknown }>(
    ({ id, approve, body }) => ({ path: `/admin/card-candidates/${id}/${approve ? 'approve' : 'reject'}`, method: 'POST', body: body ?? {} }),
    keys,
  );
  if (!q.data) return <Spinner />;
  if (!q.data.length) return <EmptyState title="No researched cards waiting for review" />;
  const set = (id: string, patch: Record<string, unknown>) => setOpts({ ...opts, [id]: { ...opts[id], ...patch } });
  return (
    <Panel title={`Researched cards to review (${q.data.length})`} data-testid="candidates">
      <ul className="divide-y divide-slate-100">
        {q.data.map((c) => {
          const o = opts[c.id] ?? {};
          const newPoints = !c.matchedCardId && c.data.rewardsProgram && !/cash/i.test(c.data.rewardsProgram);
          return (
            <li key={c.id} className="space-y-2 py-4 text-sm" data-testid="candidate">
              <div className="flex flex-wrap items-center gap-2">
                <BrandLogo brand={{ name: c.issuerName }} kinds={['ISSUER']} size="md" decorative />
                <span className="font-medium">{c.name}</span>
                <span className="text-slate-600">
                  · {c.issuerName}
                  {c.network && ` · ${c.network}`} · {c.annualFeeCents == null ? 'fee not stated' : c.annualFeeCents ? `${money(c.annualFeeCents)}/yr` : 'no annual fee'}
                </span>
                <Badge tone={verificationTone(c.verification)}>
                  {c.verification.toLowerCase()} · {c.verifiedFacts}/{c.totalFacts} checked
                </Badge>
                <Badge tone={c.matchedCardId ? 'slate' : 'brand'}>{c.matchedCardId ? 'updates catalog card' : 'new card'}</Badge>
              </div>
              <p className="break-all text-xs text-slate-500">
                {c.productUrl} — {EVIDENCE_FROM[c.evidenceFrom] ?? c.evidenceFrom}
              </p>
              <ul className="space-y-1 text-xs">
                {c.data.facts.map((f, i) => (
                  <li key={`f${i}`}>
                    <span aria-label={f.verified ? 'checked' : 'not checked'}>{f.verified ? '✓' : '?'}</span> {FIELD_LABEL[f.field] ?? f.field}:{' '}
                    <strong>{formatFieldValue(f.field, f.value)}</strong> <span className="text-slate-500">“{f.evidence}”</span>
                  </li>
                ))}
                {c.data.rewards.map((r, i) => (
                  <li key={`r${i}`}>
                    <span aria-label={r.verified ? 'checked' : 'not checked'}>{r.verified ? '✓' : '?'}</span> {r.category}: <strong>{r.rate}X</strong>{' '}
                    <span className="text-slate-500">“{r.evidence}”</span>
                  </li>
                ))}
                {c.data.features.map((f, i) => (
                  <li key={`x${i}`}>
                    <span aria-label={f.verified ? 'checked' : 'not checked'}>{f.verified ? '✓' : '?'}</span> {f.text}
                  </li>
                ))}
              </ul>
              {!!c.data.leads?.length && (
                <p className="text-xs text-slate-500" data-testid="candidate-leads">
                  Leads (not evidence):{' '}
                  {c.data.leads.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 && ' · '}
                      <a className="underline" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                        {l.title || new URL(l.url).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {c.matchedCardId && c.data.rewards.length > 0 && (
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!!o.applyRewards} onChange={(e) => set(c.id, { applyRewards: e.target.checked })} /> Replace earning rates
                  </label>
                )}
                {c.verifiedFacts === 0 && (
                  <label className="flex items-center gap-1 text-xs text-red-700">
                    <input type="checkbox" checked={!!o.acceptUnverified} onChange={(e) => set(c.id, { acceptUnverified: e.target.checked })} /> Use unchecked facts (I verified
                    them myself)
                  </label>
                )}
                {newPoints && (
                  <label className="flex items-center gap-1 text-xs" htmlFor={`cpp-${c.id}`}>
                    {c.data.rewardsProgram} value (¢/pt)
                    <Input
                      id={`cpp-${c.id}`}
                      className="w-20"
                      inputMode="decimal"
                      placeholder="1.0"
                      value={o.centsPerPoint ?? ''}
                      onChange={(e) => set(c.id, { centsPerPoint: e.target.value })}
                    />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={c.verifiedFacts === 0 && !o.acceptUnverified}
                  loading={decide.isPending && decide.variables?.id === c.id && decide.variables.approve}
                  onClick={() =>
                    decide.mutate({
                      id: c.id,
                      approve: true,
                      body: {
                        ...(o.applyRewards && { applyRewards: true }),
                        ...(o.acceptUnverified && { acceptUnverified: true }),
                        ...(o.centsPerPoint && Number(o.centsPerPoint) > 0 && { centsPerPoint: Number(o.centsPerPoint) }),
                      },
                    })
                  }
                >
                  {c.matchedCardId ? 'Approve → change proposals' : 'Approve → add to catalog'}
                </Button>
                <Button variant="ghost" onClick={() => decide.mutate({ id: c.id, approve: false })}>
                  Reject
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorText error={decide.error} />
    </Panel>
  );
}

function Sources() {
  const q = useAuthedQuery<Source[]>(['admin', 'sources'], '/admin/card-sources');
  const cards = useCardSearch('');
  const keys = [
    ['admin', 'sources'],
    ['admin', 'proposals'],
  ] as const;
  const [cardId, setCardId] = useState('');
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const add = useApiMutation<void>(
    () => ({
      path: '/admin/card-sources',
      method: 'POST',
      body: { cardId, url },
    }),
    keys,
  );
  const refresh = useApiMutation<string, { status: string; proposals: number; error?: string }>(
    (id) => ({
      path: `/admin/card-sources/${id}/refresh?force=true`,
      method: 'POST',
    }),
    keys,
  );
  const extract = useApiMutation<void, { proposals: number; findings: number }>(
    () => ({
      path: `/admin/cards/${cardId}/extract`,
      method: 'POST',
      body: { text: paste },
    }),
    keys,
  );
  const toggle = useApiMutation<{ id: string; active: boolean }>(
    ({ id, active }) => ({
      path: `/admin/card-sources/${id}`,
      method: 'PATCH',
      body: { active },
    }),
    keys,
  );
  return (
    <>
      <Panel title="Add a source" data-testid="add-source">
        <p className="mb-3 text-sm text-slate-600">
          Public issuer product pages only (allow-listed issuer domains, https). The refresh job runs daily, honours robots.txt and only proposes changes. Never use other card apps
          or aggregators as sources.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Card" htmlFor="src-card">
            <Select id="src-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              <option value="">Choose…</option>
              {cards.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product page URL" htmlFor="src-url">
            <Input id="src-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.issuer.com/credit-cards/…" />
          </Field>
          <Button onClick={() => add.mutate(undefined, { onSuccess: () => setUrl('') })} disabled={!cardId || !url} loading={add.isPending}>
            Add source
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          <Field label="…or paste the page text (when a site blocks automated access)" htmlFor="src-paste">
            <textarea
              id="src-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={4}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Button variant="secondary" onClick={() => extract.mutate(undefined)} disabled={!cardId || paste.length < 20} loading={extract.isPending}>
            Extract changes
          </Button>
          {extract.data && (
            <p className="text-sm text-slate-700" role="status">
              {extract.data.findings} facts found, {extract.data.proposals} changes proposed for review.
            </p>
          )}
        </div>
        <ErrorText error={add.error ?? extract.error} />
      </Panel>
      <Panel title="Sources" data-testid="sources">
        {!q.data ? (
          <Spinner />
        ) : !q.data.length ? (
          <EmptyState title="No sources yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {q.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.card.name}{' '}
                    {s.lastStatus && (
                      <Badge tone={s.lastStatus === 'ERROR' || s.lastStatus === 'BLOCKED' ? 'red' : s.lastStatus === 'PROPOSED' ? 'amber' : 'slate'}>{s.lastStatus}</Badge>
                    )}{' '}
                    {!s.active && <Badge>paused</Badge>} {s._count.proposals > 0 && <Badge tone="amber">{s._count.proposals} to review</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {s.url} · {s.lastFetchedAt ? `checked ${shortDate(s.lastFetchedAt)}` : 'never checked'}
                    {s.lastError && <span className="text-red-700"> · {s.lastError}</span>}
                  </p>
                </div>
                <span className="flex gap-2">
                  <Button variant="secondary" onClick={() => refresh.mutate(s.id)} loading={refresh.isPending && refresh.variables === s.id}>
                    Refresh now
                  </Button>
                  <Button variant="ghost" onClick={() => toggle.mutate({ id: s.id, active: !s.active })}>
                    {s.active ? 'Pause' : 'Resume'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {refresh.data && (
          <p className="mt-2 text-sm" role="status">
            {refresh.data.status}: {refresh.data.proposals} change(s) proposed
            {refresh.data.error ? ` — ${refresh.data.error}` : ''}
          </p>
        )}
        <ErrorText error={refresh.error ?? toggle.error} />
      </Panel>
    </>
  );
}

function Offers() {
  const q = useAuthedQuery<WelcomeBonus[]>(['admin', 'offers'], '/welcome-bonuses');
  const [slug, setSlug] = useState('');
  const h = useAuthedQuery<History>(['admin', 'offers', slug], `/cards/${slug}/offer-history`, { enabled: !!slug });
  if (!q.data) return <Spinner />;
  const fmt = (w: WelcomeBonus) =>
    w.bonusAmount == null ? '—' : w.bonusType === 'CASH' ? money(w.bonusAmount) : `${w.bonusAmount.toLocaleString('en-US')} ${w.bonusType?.toLowerCase() ?? ''}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Current welcome offers" data-testid="welcome-offers">
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.map((w) => (
            <li key={w.slug}>
              <button
                type="button"
                onClick={() => setSlug(w.slug)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-slate-50"
                aria-pressed={slug === w.slug}
              >
                <span className="min-w-0">
                  <span className="font-medium">{w.card}</span> {w.elevated && <Badge tone="green">elevated</Badge>}
                  <span className="block text-xs text-slate-500">
                    {fmt(w)}
                    {w.minSpendCents != null && ` after ${money(w.minSpendCents)} in ${w.spendMonths} months`} · fee {money(w.annualFeeCents)}
                  </span>
                </span>
                <span className="text-right text-xs tabular-nums text-slate-600">
                  ≈ {money(w.valuationCents)}
                  {w.median24mCents != null && <span className="block">median {money(w.median24mCents)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={h.data ? `History — ${h.data.card.name}` : 'History'} data-testid="offer-history">
        {!slug ? (
          <p className="text-sm text-slate-500">Choose a card.</p>
        ) : !h.data ? (
          <Spinner />
        ) : (
          <>
            <p className="mb-3 text-lg font-semibold" data-testid="offer-timeline">
              {h.data.timeline || '—'}
            </p>
            <BarList
              format={(v) => money(v)}
              items={h.data.versions
                .filter((v) => v.valuationCents != null)
                .map((v) => ({
                  label: `${shortDate(v.validFrom)} → ${v.validTo ? shortDate(v.validTo) : 'now'}`,
                  value: v.valuationCents as number,
                  hint: `${v.bonusAmount?.toLocaleString('en-US') ?? '—'} · fee ${money(v.annualFeeCents)}${v.elevated ? ' · elevated' : ''}`,
                }))}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

interface AdminPartner {
  id: string;
  ratioFrom: number;
  ratioTo: number;
  transferDays: number;
  bonusPercent: number;
  bonusEndsAt: string | null;
  currency: { code: string; name: string };
  program: { code: string; name: string };
}

function Partners() {
  const q = useAuthedQuery<AdminPartner[]>(['admin', 'partners'], '/admin/transfer-partners');
  const keys = [['admin', 'partners'], ['travel']] as const;
  const [f, setF] = useState({
    currency: '',
    program: '',
    ratioFrom: '1',
    ratioTo: '1',
    transferDays: '0',
    bonusPercent: '0',
    bonusEndsAt: '',
  });
  const save = useApiMutation<void>(
    () => ({
      path: '/admin/transfer-partners',
      method: 'PUT',
      body: {
        currency: f.currency.trim().toUpperCase(),
        program: f.program.trim().toUpperCase(),
        ratioFrom: Number(f.ratioFrom),
        ratioTo: Number(f.ratioTo),
        transferDays: Number(f.transferDays),
        bonusPercent: Number(f.bonusPercent),
        bonusEndsAt: f.bonusEndsAt ? new Date(`${f.bonusEndsAt}T23:59:59Z`).toISOString() : null,
      },
    }),
    keys,
  );
  const remove = useApiMutation<string>((id) => ({ path: `/admin/transfer-partners/${id}`, method: 'DELETE' }), keys);
  const edit = (p: AdminPartner) =>
    setF({
      currency: p.currency.code,
      program: p.program.code,
      ratioFrom: String(p.ratioFrom),
      ratioTo: String(p.ratioTo),
      transferDays: String(p.transferDays),
      bonusPercent: String(p.bonusPercent),
      bonusEndsAt: p.bonusEndsAt ? p.bonusEndsAt.slice(0, 10) : '',
    });
  return (
    <Panel title="Transfer partners" data-testid="admin-partners">
      {q.isLoading ? (
        <Spinner label="Loading partners" />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Transfer partners table">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1 font-semibold">Currency → Program</th>
                <th className="py-1 text-right font-semibold">Ratio</th>
                <th className="py-1 text-right font-semibold">Days</th>
                <th className="py-1 font-semibold">Bonus</th>
                <th className="py-1">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data?.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">
                    {p.currency.name} → {p.program.name}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.ratioFrom}:{p.ratioTo}
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.transferDays}</td>
                  <td className="py-2">{p.bonusPercent ? `+${p.bonusPercent} %${p.bonusEndsAt ? ` until ${shortDate(p.bonusEndsAt)}` : ''}` : '—'}</td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => edit(p)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => remove.mutate(p.id)} aria-label={`Remove ${p.currency.code} to ${p.program.code}`}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Currency code" htmlFor="tp-cur">
          <Input id="tp-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} placeholder="CONTOSO_PTS" required />
        </Field>
        <Field label="Program code" htmlFor="tp-prog">
          <Input id="tp-prog" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} placeholder="AEROLINK" required />
        </Field>
        <Field label="Ratio (from : to)" htmlFor="tp-from">
          <div className="flex items-center gap-1">
            <Input id="tp-from" type="number" min={1} value={f.ratioFrom} onChange={(e) => setF({ ...f, ratioFrom: e.target.value })} />
            <span aria-hidden>:</span>
            <label htmlFor="tp-to" className="sr-only">
              Ratio to
            </label>
            <Input id="tp-to" type="number" min={1} value={f.ratioTo} onChange={(e) => setF({ ...f, ratioTo: e.target.value })} />
          </div>
        </Field>
        <Field label="Transfer days" htmlFor="tp-days">
          <Input id="tp-days" type="number" min={0} max={60} value={f.transferDays} onChange={(e) => setF({ ...f, transferDays: e.target.value })} />
        </Field>
        <Field label="Bonus %" htmlFor="tp-bonus">
          <Input id="tp-bonus" type="number" min={0} max={200} value={f.bonusPercent} onChange={(e) => setF({ ...f, bonusPercent: e.target.value })} />
        </Field>
        <Field label="Bonus ends" htmlFor="tp-ends">
          <Input id="tp-ends" type="date" value={f.bonusEndsAt} onChange={(e) => setF({ ...f, bonusEndsAt: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" loading={save.isPending}>
            Save partner
          </Button>
        </div>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Panel>
  );
}

interface CoverageRow {
  issuer: string;
  kind: 'BANK' | 'CREDIT_UNION' | 'CARD_COMPANY' | 'FINTECH';
  website: string | null;
  personal: number;
  business: number;
  verified: number;
  lastResearchedAt: string | null;
  pendingReview: number;
}
interface CoverageReport {
  totals: { issuers: number; creditUnions: number; cards: number; personal: number; business: number; verified: number; neverResearched: number; withoutCards: number };
  issuers: CoverageRow[];
}
const KIND_LABEL: Record<CoverageRow['kind'], string> = { BANK: 'Bank', CREDIT_UNION: 'Credit union', CARD_COMPANY: 'Card company', FINTECH: 'Fintech' };

/** Which banks and credit unions the catalog covers, personal vs business, verified, last researched. */
function Coverage() {
  const q = useAuthedQuery<CoverageReport>(['admin', 'coverage'], '/admin/card-research/coverage');
  const status = useAuthedQuery<ResearchStatus>(['admin', 'research-status'], '/admin/card-research/status');
  const [kind, setKind] = useState<'' | CoverageRow['kind']>('');
  const keys = [
    ['admin', 'coverage'],
    ['admin', 'research-runs'],
  ] as const;
  const kick = useApiMutation<void>(() => ({ path: '/admin/jobs/research-cards', method: 'POST' }), keys);
  const all = useApiMutation<void, { queued: number; skippedRecent: number }>(
    () => ({ path: '/admin/card-research/discover-all', method: 'POST', body: kind ? { kinds: [kind] } : {} }),
    keys,
  );
  if (!q.data) return <Spinner />;
  const s = q.data.totals;
  const rows = q.data.issuers.filter((r) => !kind || r.kind === kind);
  return (
    <div className="space-y-6">
      <StatTiles
        testId="coverage-totals"
        items={[
          ['Issuers', String(s.issuers), `${s.creditUnions} credit unions`],
          ['Cards', String(s.cards), `${s.personal} personal · ${s.business} business`],
          ['Verified on issuer pages', String(s.verified), `${s.cards - s.verified} not yet`],
          ['Never researched', String(s.neverResearched), `${s.withoutCards} issuers without cards yet`],
        ]}
      />
      <Panel
        title="Coverage by issuer"
        data-testid="coverage"
        action={
          <Tabs<'' | CoverageRow['kind']>
            label="Institution type"
            value={kind}
            onChange={setKind}
            options={[
              ['', 'All'],
              ['BANK', 'Banks'],
              ['CREDIT_UNION', 'Credit unions'],
              ['CARD_COMPANY', 'Card companies'],
              ['FINTECH', 'Fintech'],
            ]}
          />
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          No public list covers every card, so the catalog grows by research: the agent reads each issuer&apos;s own website for its current personal and business cards, and new
          cards wait for your approval in <em>Research</em>. Each issuer is one billed run (model tokens + web searches).
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button disabled={!status.data?.available} loading={all.isPending} onClick={() => all.mutate(undefined, { onSuccess: () => kick.mutate() })}>
            Research {kind ? KIND_LABEL[kind].toLowerCase() + 's' : 'all issuers'} not checked in 30 days
          </Button>
          {status.data && !status.data.available && <span className="text-xs text-amber-800">{status.data.note}</span>}
          {all.data && (
            <span className="text-sm text-slate-700" role="status">
              {all.data.queued} research runs queued{all.data.skippedRecent > 0 && ` · ${all.data.skippedRecent} skipped (recently researched or already queued)`}
            </span>
          )}
        </div>
        <ErrorText error={all.error} />
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Coverage by issuer">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3">Issuer</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3 text-right">Personal</th>
                <th className="py-2 pr-3 text-right">Business</th>
                <th className="py-2 pr-3 text-right">Verified</th>
                <th className="py-2 pr-3">Last Researched</th>
                <th className="py-2 pr-3 text-right">To Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.issuer} data-testid="coverage-row">
                  <td className="py-2 pr-3 font-medium"><span className="inline-flex items-center gap-2"><BrandLogo brand={{ name: r.issuer }} kinds={['ISSUER']} size="sm" decorative />{r.issuer}</span></td>
                  <td className="py-2 pr-3">{KIND_LABEL[r.kind]}</td>
                  <td className="py-2 pr-3 text-right">{r.personal}</td>
                  <td className="py-2 pr-3 text-right">{r.business}</td>
                  <td className="py-2 pr-3 text-right">{r.verified}</td>
                  <td className="py-2 pr-3">{r.lastResearchedAt ? shortDate(r.lastResearchedAt) : <Badge tone="amber">never</Badge>}</td>
                  <td className="py-2 pr-3 text-right">{r.pendingReview || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
