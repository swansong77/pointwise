import { fireEvent, render, screen } from '@testing-library/react';
import { BarList, Five24Gauge, Five24TimelineChart, StatTiles, Tabs } from '@/components/charts';
import {
  arcPath,
  FIVE24_REASON,
  gaugeFraction,
  monthYear,
  parseAmount,
  percent,
  periodLabel,
  RELATIONSHIP_LABEL,
  STATUS_LABEL,
  statusTone,
  stepPath,
  timelineSteps,
  uploadProblem,
} from '@/lib/portfolio';
import { pushSupported, urlBase64ToUint8Array } from '@/lib/push';

describe('portfolio helpers', () => {
  it('labels and tones', () => {
    expect(RELATIONSHIP_LABEL.SPOUSE).toBe('Spouse');
    expect(STATUS_LABEL.EXPIRING_SOON).toBe('Expiring soon');
    expect(FIVE24_REASON.AUTHORIZED_USER).toMatch(/Authorized user/);
    expect(['COMPLETED', 'EXPIRING_SOON', 'EXPIRED', 'PARTIAL', 'UNUSED'].map((s) => statusTone(s as never))).toEqual(['green', 'amber', 'red', 'brand', 'slate']);
  });

  it('periodLabel', () => {
    expect(periodLabel('MONTHLY')).toBe('Monthly');
    expect(periodLabel('QUARTERLY')).toBe('Quarterly');
    expect(periodLabel('SEMIANNUAL')).toBe('Twice a year');
    expect(periodLabel('ANNUAL', 12, 'CARDMEMBER_YEAR')).toBe('Yearly (card anniversary)');
    expect(periodLabel('MULTI_YEAR', 48, 'CARDMEMBER_YEAR')).toBe('Every 4 years');
    expect(periodLabel('MULTI_YEAR', 54)).toBe('Every 4.5 years');
  });

  it('gauge geometry', () => {
    expect(gaugeFraction(3)).toBe(0.5);
    expect(gaugeFraction(9)).toBe(1);
    expect(gaugeFraction(-1)).toBe(0);
    expect(arcPath(0)).toBe('M 20 100 A 80 80 0 0 1 20 100');
    expect(arcPath(1)).toBe('M 20 100 A 80 80 0 0 1 180 100');
    expect(arcPath(0.5)).toBe('M 20 100 A 80 80 0 0 1 100 20');
  });

  it('timeline steps and path', () => {
    const pts = [
      { date: '2026-01-01T00:00:00Z', count: 6, label: '6/24+', cardId: null, event: 'NOW' as const },
      { date: '2026-07-01T00:00:00Z', count: 3, label: '3/24', cardId: 'a', event: 'DROP' as const },
      { date: '2027-01-01T00:00:00Z', count: 0, label: '0/24', cardId: 'b', event: 'DROP' as const },
    ];
    const steps = timelineSteps(pts, 600, 120);
    expect(steps.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [298, 60],
      [600, 120],
    ]);
    expect(stepPath(steps, 600)).toBe('M 0 0 H 298 V 60 H 600 V 120 H 600');
    expect(timelineSteps([])).toEqual([]);
    expect(stepPath([])).toBe('');
  });

  it('percent, monthYear, parseAmount', () => {
    expect(percent(0.045)).toBe('4.5%');
    expect(percent(0.25)).toBe('25%');
    expect(percent(null)).toBe('—');
    expect(monthYear('2025-08-01T00:00:00Z')).toBe('Aug 2025');
    expect(monthYear(null)).toBe('—');
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('$1,234.56')).toBe(123456);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('uploadProblem', () => {
    expect(uploadProblem(null)).toMatch(/Choose/);
    expect(uploadProblem({ name: 'a.pdf', size: 1 })).toMatch(/xlsx/);
    expect(uploadProblem({ name: 'a.xlsx', size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
    expect(uploadProblem({ name: 'Tracker.XLSX', size: 1000 })).toBeNull();
    expect(uploadProblem({ name: 'cards.csv', size: 1000 })).toBeNull();
  });

  it('push helpers', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
    expect(pushSupported()).toBe(false); // jsdom has no PushManager
  });
});

describe('chart components', () => {
  it('Five24Gauge shows the label and slots or over-limit text', () => {
    const { rerender } = render(<Five24Gauge count={3} label="3/24" />);
    expect(screen.getByRole('img', { name: '5/24 status 3/24' })).toBeInTheDocument();
    expect(screen.getByText('2 slots left')).toBeInTheDocument();
    rerender(<Five24Gauge count={4} label="4/24" />);
    expect(screen.getByText('1 slot left')).toBeInTheDocument();
    rerender(<Five24Gauge count={6} label="6/24+" />);
    expect(screen.getByText('Over the limit')).toBeInTheDocument();
    rerender(<Five24Gauge count={0} label="0/24" />);
    expect(screen.getByText('5 slots left')).toBeInTheDocument();
  });

  it('Five24TimelineChart renders an accessible list, or a message with nothing to project', () => {
    const { rerender } = render(
      <Five24TimelineChart
        title="Projection"
        points={[
          { date: '2026-01-01T00:00:00Z', count: 2, label: '2/24', cardId: null, event: 'NOW' },
          { date: '2026-06-01T00:00:00Z', count: 1, label: '1/24', cardId: 'a', event: 'DROP' },
          { date: '2026-09-01T00:00:00Z', count: 0, label: '0/24', cardId: 'b', event: 'DROP' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Projection' })).toBeInTheDocument();
    expect(screen.getByText('Jun 1, 2026: 1/24')).toBeInTheDocument();
    rerender(<Five24TimelineChart title="P" points={[{ date: '2026-01-01T00:00:00Z', count: 0, label: '0/24', cardId: null, event: 'NOW' }]} />);
    expect(screen.getByText(/No cards drop off/)).toBeInTheDocument();
  });

  it('BarList, StatTiles and Tabs', () => {
    const onChange = vi.fn();
    render(
      <>
        <BarList format={(v) => `$${v}`} items={[{ label: 'A', value: 10, hint: 'h' }, { label: 'B', value: -5 }]} />
        <StatTiles testId="t" items={[['Fees', '$1', 'hint'], ['Net', '$2']]} />
        <Tabs label="Group" value="a" onChange={onChange} options={[['a', 'Alpha'], ['b', 'Beta']]} />
      </>,
    );
    expect(screen.getByText('$-5')).toHaveClass('text-red-700');
    expect(screen.getByTestId('t')).toHaveTextContent('Fees$1hint');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
