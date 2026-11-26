import { Badge } from '@/components/ui';
import { money } from '@/lib/format';
import { Validation, VALIDATION_TONE, validationSummary } from '@/lib/benefit-audit';

/** How completely a statement was imported: counts and amounts found vs imported, with a PASS / WARNING / FAILED badge. */
export function ValidationReport({ v }: { v: Validation }) {
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid="validation-report">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={VALIDATION_TONE[v.status]}>
          <span data-testid="validation-status">{v.status}</span>
        </Badge>
        <span className="text-slate-700">{validationSummary(v)}</span>
        <span className="ml-auto text-xs text-slate-500">confidence {v.confidence}%</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt>Statement transactions</dt>
          <dd className="font-medium text-slate-800">{v.statementCount}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd className="font-medium text-slate-800">{v.importedCount}</dd>
        </div>
        <div>
          <dt>Difference</dt>
          <dd className="font-medium text-slate-800">{v.differenceCount}</dd>
        </div>
        <div>
          <dt>Missing amount</dt>
          <dd className="font-medium text-slate-800">{money(v.missingCents)}</dd>
        </div>
      </dl>
      {v.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
          {v.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
