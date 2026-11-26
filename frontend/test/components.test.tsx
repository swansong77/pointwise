import { fireEvent, render, screen } from '@testing-library/react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, ProgressBar, Spinner } from '@/components/ui';
import { CardSwatch, RankedCardRow, categoryEmoji } from '@/components/card-bits';

describe('ui components', () => {
  it('Button handles click, loading and disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    for (const v of ['secondary', 'ghost', 'danger'] as const) {
      rerender(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole('button', { name: v })).toBeInTheDocument();
    }
  });

  it('Field associates label, shows hint or error', () => {
    const { rerender } = render(
      <Field label="Email" htmlFor="e" hint="We never share it">
        <Input id="e" />
      </Field>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('We never share it')).toBeInTheDocument();
    rerender(
      <Field label="Email" htmlFor="e" hint="hint" error="Required">
        <Input id="e" />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.queryByText('hint')).not.toBeInTheDocument();
  });

  it('ProgressBar clamps and exposes aria values', () => {
    render(<ProgressBar value={140} label="Bonus" />);
    expect(screen.getByRole('progressbar', { name: 'Bonus' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('ErrorText renders Error, string, and nothing', () => {
    const { rerender, container } = render(<ErrorText error={new Error('boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    rerender(<ErrorText error="plain" />);
    expect(screen.getByRole('alert')).toHaveTextContent('plain');
    rerender(<ErrorText error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Panel, PageHeader, Badge, EmptyState, Spinner render', () => {
    render(
      <>
        <PageHeader title="Wallet" subtitle="sub" action={<span>act</span>} />
        <Panel title="T" action={<span>A</span>}>
          body
        </Panel>
        {(['slate', 'green', 'amber', 'red', 'brand'] as const).map((t) => (
          <Badge key={t} tone={t}>
            {t}
          </Badge>
        ))}
        <EmptyState title="Nothing">more</EmptyState>
        <Spinner />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Wallet' })).toBeInTheDocument();
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});

describe('card bits', () => {
  it('categoryEmoji falls back', () => {
    expect(categoryEmoji('utensils')).toBe('🍽️');
    expect(categoryEmoji('unknown')).toBe('🏷️');
    expect(categoryEmoji(null)).toBe('🏷️');
  });
  it('RankedCardRow shows rate and pinned marker', () => {
    render(
      <ul>
        <RankedCardRow
          rank={1}
          r={{ walletCardId: 'w', cardId: 'c', name: 'Gold', color: '#b45309', multiplier: 4, centsPerPoint: 1.25, centsPerDollar: 5, matchLevel: 'CATEGORY', reason: '4X dining', pinned: true }}
        />
      </ul>,
    );
    expect(screen.getByText('5¢/$')).toBeInTheDocument();
    expect(screen.getByText(/pinned/)).toBeInTheDocument();
    expect(screen.getByText('4x × 1.25¢')).toBeInTheDocument();
  });
  it('CardSwatch sizes', () => {
    const { container } = render(<CardSwatch color="#000" size="sm" />);
    expect(container.firstChild).toHaveClass('h-4');
  });
});
