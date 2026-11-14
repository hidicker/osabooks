/**
 * Sending payment reminders, and recording each as it goes.
 *
 * The record says which invoices have been reminded at which stage; the next
 * morning's run reads it to decide who is due. Recorded only at the end, a
 * run that stopped part way (a timeout, the database not answering) would
 * leave emails sent and nothing written, and the next morning would send them
 * again. So each email is recorded as soon as it has gone, and a record that
 * cannot be written stops the run: nothing goes out that is not recorded.
 * An email that fails to send is logged and not marked, so it is tried again.
 */

export interface ReminderToSend {
  customer: string;
  to: string;
  /** The stage each invoice is now reminded at, to record once it is sent. */
  stages: Readonly<Record<string, number>>;
}

export interface ReminderLogEntry {
  at: string;
  to: string;
  customer: string;
  invoices: string[];
  failed?: string;
}

export interface RemindersHeld {
  sent: Record<string, number>;
  log: ReminderLogEntry[];
}

export async function sendReminders<E extends ReminderToSend>(
  emails: readonly E[],
  held: RemindersHeld,
  send: (email: E) => Promise<void>,
  record: (held: RemindersHeld) => Promise<void>,
  now: () => string = () => new Date().toISOString(),
): Promise<RemindersHeld & { count: number }> {
  const sent = { ...held.sent };
  const log = [...held.log];
  let count = 0;
  for (const email of emails) {
    const at = now();
    const invoices = Object.keys(email.stages);
    try {
      await send(email);
    } catch (error) {
      log.unshift({ at, to: email.to, customer: email.customer, invoices, failed: (error as Error).message });
      continue;
    }
    Object.assign(sent, email.stages);
    log.unshift({ at, to: email.to, customer: email.customer, invoices });
    count += 1;
    // Before the next one goes: a failure here stops the run.
    await record({ sent, log });
  }
  return { sent, log, count };
}
