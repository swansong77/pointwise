import clsx from 'clsx';
import { Brand, BrandKind, BrandQuery, initials, logoUrl, monogramColor, resolveBrand } from '@/lib/brands';

/* eslint-disable @next/next/no-img-element -- small local SVGs; next/image adds nothing for them */

const SIZE = { xs: 16, sm: 20, md: 28, lg: 40, xl: 56 } as const;
export type LogoSize = keyof typeof SIZE;

interface Props {
  /** a brand, or what to look one up by (name, code, slug, issuer) */
  brand?: Brand | BrandQuery | string | null;
  /** shown in the monogram and used as the accessible name when the brand is not found */
  name?: string;
  kinds?: BrandKind[];
  size?: LogoSize;
  /** the name is written next to the logo, so the image itself adds nothing for a screen reader */
  decorative?: boolean;
  /** render nothing when no brand is recognised (lists of free-text merchant names) */
  hideUnknown?: boolean;
  className?: string;
}

const isBrand = (b: unknown): b is Brand => typeof b === 'object' && b !== null && 'key' in b && 'kind' in b && 'aliases' in b;

/**
 * A brand logo: the vendored icon on a white tile, or a monogram badge when there is no icon. Never loads anything
 * from a third party.
 */
export function BrandLogo({ brand, name, kinds, size = 'md', decorative = false, hideUnknown = false, className }: Props) {
  const found = isBrand(brand) ? brand : resolveBrand(brand ?? name, kinds);
  if (!found && hideUnknown) return null;
  const label = found?.name ?? name ?? (typeof brand === 'string' ? brand : (brand as BrandQuery | null | undefined)?.name) ?? '';
  const px = SIZE[size];
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': `${label} logo` };
  const url = found ? logoUrl(found) : null;
  if (url) {
    return (
      <span {...a11y} data-testid="brand-logo" data-brand={found!.key} className={clsx('inline-flex shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-slate-200', className)} style={{ width: px, height: px, padding: Math.round(px * 0.14) }}>
        <img src={url} alt="" width={px} height={px} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </span>
    );
  }
  const text = initials(label || '?');
  return (
    <span
      {...a11y}
      data-testid="brand-logo"
      data-brand={found?.key ?? 'monogram'}
      data-monogram="true"
      className={clsx('inline-flex shrink-0 select-none items-center justify-center rounded-md font-semibold text-white', className)}
      style={{ width: px, height: px, background: monogramColor(found?.name ?? label), fontSize: Math.max(8, Math.round(px * (text.length > 1 ? 0.38 : 0.5))) }}
    >
      {text}
    </span>
  );
}

/** Logo and name together (the name is the accessible text, so the logo is decorative). */
export function BrandLabel({ brand, name, kinds, size = 'sm', className }: Props) {
  const found = isBrand(brand) ? brand : resolveBrand(brand ?? name, kinds);
  const label = name ?? found?.name ?? (typeof brand === 'string' ? brand : '');
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <BrandLogo brand={found ?? brand} name={label} kinds={kinds} size={size} decorative />
      <span>{label}</span>
    </span>
  );
}
