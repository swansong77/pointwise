import * as nodemailer from 'nodemailer';
import { MailService } from '../../src/jobs/mail.service';

jest.mock('nodemailer');

const cfg = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as never;
const create = nodemailer.createTransport as jest.Mock;

describe('TC-MAIL: how the server reaches its mail provider', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
  });

  it('local development talks to MailHog: no login, no TLS', () => {
    new MailService(cfg({ SMTP_HOST: 'mailhog', SMTP_PORT: '1025', NODE_ENV: 'development' }));
    expect(create).toHaveBeenCalledWith({ host: 'mailhog', port: 1025, secure: false, ignoreTLS: true });
  });

  it('a real provider on 587: login, and the connection upgrades with STARTTLS (TLS is not ignored in production)', () => {
    new MailService(cfg({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', NODE_ENV: 'production', SMTP_USER: 'apikey', SMTP_PASSWORD: 'secret' }));
    expect(create).toHaveBeenCalledWith({ host: 'smtp.example.test', port: 587, secure: false, ignoreTLS: false, auth: { user: 'apikey', pass: 'secret' } });
  });

  it('port 465 uses TLS from the start when SMTP_SECURE is true', () => {
    new MailService(cfg({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', NODE_ENV: 'production', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }));
    expect(create.mock.calls[0][0]).toMatchObject({ port: 465, secure: true });
  });

  it('a username without a password (or the reverse) sends no login rather than a half one', () => {
    new MailService(cfg({ NODE_ENV: 'production', SMTP_USER: 'only-a-user' }));
    expect(create.mock.calls[0][0]).not.toHaveProperty('auth');
    new MailService(cfg({ NODE_ENV: 'production', SMTP_PASSWORD: 'only-a-password' }));
    expect(create.mock.calls[1][0]).not.toHaveProperty('auth');
  });

  it('defaults to localhost:1025 and sends nothing when mail is disabled', async () => {
    const svc = new MailService(cfg({ MAIL_DISABLED: 'true' }));
    expect(create.mock.calls[0][0]).toMatchObject({ host: 'localhost', port: 1025 });
    expect(await svc.send('a@b.test', 's', 'b')).toBe(false);
  });

  it('reports a failed send as false instead of throwing', async () => {
    create.mockReturnValue({ sendMail: jest.fn().mockRejectedValue(new Error('refused')) });
    expect(await new MailService(cfg({})).send('a@b.test', 's', 'b')).toBe(false);
  });
});
