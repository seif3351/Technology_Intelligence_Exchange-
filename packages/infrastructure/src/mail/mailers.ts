import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mailer, OutgoingEmail } from '@atx/application';
import { createTransport } from 'nodemailer';

/** SMTP delivery (any provider: SES, Postmark, Mailgun, corporate relay). TLS per the URL scheme/port. */
export const createSmtpMailer = (smtpUrl: string, from: string): Mailer => {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
    },
  };
};

/**
 * Development inbox: each message is written to a file in `directory` so
 * links (verification, reset, invitation) can be opened locally. Never use
 * in production (the configuration refuses it).
 */
export const createFileMailer = (directory: string): Mailer => ({
  async send(message) {
    await mkdir(directory, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${message.to.replace(/[^a-z0-9@.-]/gi, '_')}.txt`;
    await writeFile(
      path.join(directory, name),
      `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
      { mode: 0o600 },
    );
  },
});

/** In-memory mailbox for automated tests. */
export const createMemoryMailer = (): Mailer & { readonly messages: OutgoingEmail[] } => {
  const messages: OutgoingEmail[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
};

/** Used when no mail delivery is configured: sending is a no-op that callers can detect. */
export const disabledMailer: Mailer = {
  async send() {
    throw new Error('mail delivery is not configured');
  },
};
