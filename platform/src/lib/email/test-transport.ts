import type { EmailMessage, EmailTransport } from "./types";

/**
 * Records every message in memory instead of sending anything — the only
 * transport integration tests use. Lets tests assert on exactly what would
 * have been sent (subject, body, and the accept URL/raw token embedded in
 * it) without any real network call or vendor credential.
 */
export class InMemoryEmailTransport implements EmailTransport {
  public readonly sentMessages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sentMessages.push(message);
  }
}
