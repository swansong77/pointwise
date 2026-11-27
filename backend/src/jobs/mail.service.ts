import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    // Local development talks to MailHog (no login, no TLS). A real provider needs a login and TLS: set SMTP_USER and SMTP_PASSWORD,
    // and SMTP_SECURE=true for port 465 (implicit TLS); on 587 the connection upgrades with STARTTLS.
    const user = config.get<string>("SMTP_USER");
    const pass = config.get<string>("SMTP_PASSWORD");
    this.transport = nodemailer.createTransport({
      host: config.get("SMTP_HOST") ?? "localhost",
      port: Number(config.get("SMTP_PORT") ?? 1025),
      secure: config.get("SMTP_SECURE") === "true",
      ignoreTLS: config.get("NODE_ENV") !== "production",
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (this.config.get("MAIL_DISABLED") === "true") return false;
    try {
      await this.transport.sendMail({
        from:
          this.config.get("MAIL_FROM") ??
          "PointWise <no-reply@pointwise.local>",
        to,
        subject,
        text,
      });
      return true;
    } catch (e) {
      this.logger.warn(`mail to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
