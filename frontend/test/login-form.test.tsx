import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const refresh = vi.fn();
const signIn = vi.fn();
let search = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => search,
}));
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

import { LoginForm } from '@/app/login/login-form';

describe('LoginForm', () => {
  beforeEach(() => {
    push.mockReset();
    signIn.mockReset();
    search = new URLSearchParams();
  });

  it('signs in and redirects to a safe callback', async () => {
    search = new URLSearchParams('callbackUrl=/offers');
    signIn.mockResolvedValue({ ok: true, error: null });
    render(<LoginForm providers={{ google: false, apple: false }} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/offers'));
    expect(signIn).toHaveBeenCalledWith('credentials', { email: 'a@b.co', password: 'pw', redirect: false });
  });

  it('shows a generic error on failure and does not redirect', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' });
    render(<LoginForm providers={{ google: false, apple: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(push).not.toHaveBeenCalled();
  });

  it('shows OAuth buttons only when providers are configured', () => {
    search = new URLSearchParams('error=OAuthSignin');
    render(<LoginForm providers={{ google: true, apple: true }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    expect(signIn).toHaveBeenCalledWith('apple', { callbackUrl: '/dashboard' });
  });
});
