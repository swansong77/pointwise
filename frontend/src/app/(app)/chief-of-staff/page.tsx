'use client';

import Link from 'next/link';
import { ChiefBoard } from '@/components/chief-board';
import { ChiefCenter } from '@/components/chief-center';
import { ChiefCommand } from '@/components/chief-command';
import { ChiefFees } from '@/components/chief-fees';
import { ChiefGovernance } from '@/components/chief-governance';
import { ChiefHousehold } from '@/components/chief-household';
import { ChiefLife } from '@/components/chief-life';
import { ChiefRoadmap } from '@/components/chief-roadmap';
import { PageHeader } from '@/components/ui';

/** The Chief of Staff: what needs attention today, what is at risk, and what to do, in one place. */
export default function ChiefOfStaffPage() {
  return (
    <div className="space-y-6" data-testid="chief-page">
      <PageHeader
        title="Chief of Staff"
        subtitle="Everything PointWise knows, ranked into a short list: what to do, what it is worth, how long it takes and how risky it is. It only recommends; nothing is applied, transferred, booked or cancelled for you."
        action={
          <Link href="/settings#copilot" className="text-sm text-brand-700 underline">
            Chief of Staff settings
          </Link>
        }
      />
      <nav aria-label="On this page" className="flex flex-wrap gap-3 text-sm" data-testid="chief-jump">
        {[
          ['#command', 'Command center'],
          ['#recovery', 'Value recovery'],
          ['#fees', 'Fee review'],
          ['#governance', 'Applications'],
          ['#roadmap', 'Roadmap'],
          ['#life', 'Life events'],
          ['#household', 'Household'],
          ['#board', 'Board report'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="text-brand-700 underline">
            {label}
          </a>
        ))}
      </nav>
      <ChiefCenter />
      <div id="command" />
      <ChiefCommand />
      <ChiefFees />
      <ChiefGovernance />
      <ChiefRoadmap />
      <ChiefLife />
      <ChiefHousehold />
      <ChiefBoard />
    </div>
  );
}
