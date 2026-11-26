/** Client-side validation mirrors the API rules (the API remains the source of truth). */

export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters';
  if (pw.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(pw) || !/[^A-Za-z]/.test(pw)) return 'Include a letter and a number or symbol';
  return null;
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address';
}

export function validateLastFour(v: string): string | null {
  if (!v) return null;
  return /^\d{4}$/.test(v) ? null : 'Enter exactly the last 4 digits (never the full number)';
}
