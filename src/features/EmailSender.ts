import type { EmailMessage } from '../contracts/RadarDelivery.js';
export interface EmailSender {
  send(message: EmailMessage, key: string): Promise<string>;
}
/** Safe categories only; provider bodies must never reach logs or the UI. */
export class EmailSendError extends Error {
  constructor(
    readonly kind: 'transient' | 'permanent' | 'uncertain',
    readonly retryAfterMs = 0,
  ) {
    super(`Email ${kind} failure.`);
  }
}
