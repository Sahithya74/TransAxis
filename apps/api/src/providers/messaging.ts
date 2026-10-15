export interface OutboundMessage {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  body: string;
  /** Machine-readable purpose, e.g. `password_reset`. */
  purpose: string;
}

export interface DeliveryResult {
  delivered: boolean;
  /** `sent`, or why not, e.g. `not_sent_no_provider`. */
  status: string;
}

/** Abstraction over email/SMS. Nothing is sent unless a real provider is configured. */
export interface MessageProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

type Logger = { info: (obj: unknown, msg?: string) => void };

/**
 * Default provider: records that a message *would* have been sent and delivers nothing.
 * In development it logs the body so password-reset links can be used locally; in production it
 * never logs message bodies, because they can contain secrets.
 */
export class LogOnlyProvider implements MessageProvider {
  readonly name = 'log-only';
  constructor(
    private readonly logger: Logger,
    private readonly exposeBodies: boolean,
  ) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.logger.info(
      {
        channel: message.channel,
        to: message.to,
        purpose: message.purpose,
        subject: message.subject,
        ...(this.exposeBodies ? { body: message.body } : {}),
      },
      'message not sent: no messaging provider configured (log-only)',
    );
    return { delivered: false, status: 'not_sent_no_provider' };
  }
}

/** Test double that keeps every message in memory. */
export class CapturingProvider implements MessageProvider {
  readonly name = 'capturing';
  readonly sent: OutboundMessage[] = [];
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return { delivered: true, status: 'sent' };
  }
}
