import clsx from 'clsx';

/**
 * The Pointwise logo: a bold "P" with a gold dot (the point) on an indigo tile. The same mark is the favicon,
 * the install icon and the browser-extension icon (public/logo/pointwise-mark.svg).
 */
const SIZE = { sm: 24, md: 32, lg: 56, xl: 80 } as const;

export function LogoMark({ size = 'md', className, title }: { size?: keyof typeof SIZE; className?: string; title?: string }) {
  const px = SIZE[size];
  const labelled = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg {...labelled} data-testid="logo-mark" width={px} height={px} viewBox="0 0 64 64" className={clsx('shrink-0', className)}>
      <defs>
        <linearGradient id="pw-logo-g" x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#pw-logo-g)" />
      <path fill="#fff" fillRule="evenodd" d="M17 11h17a14.5 14.5 0 0 1 0 29h-6v13H17zM28 21v9h6a4.5 4.5 0 0 0 0-9z" />
      <circle cx="46.5" cy="48.5" r="6.5" fill="#fbbf24" />
    </svg>
  );
}

/** Mark and name together; the text stays real text, so it is read, selected and translated normally. */
export function Logo({ size = 'md', className, tone = 'color' }: { size?: keyof typeof SIZE; className?: string; tone?: 'color' | 'light' }) {
  const text = size === 'xl' ? 'text-3xl' : size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-base';
  return (
    <span data-testid="logo" className={clsx('inline-flex items-center gap-2 leading-none', className)}>
      <LogoMark size={size} />
      <span className={clsx('tracking-tight', text, tone === 'light' ? 'text-white' : 'text-brand-900')}>
        <span className="font-medium">Point</span>
        <span className={clsx('font-extrabold', tone === 'light' ? 'text-white' : 'text-brand-600')}>wise</span>
      </span>
    </span>
  );
}
