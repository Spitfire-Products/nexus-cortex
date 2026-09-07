/**
 * Display-history sanitizer.
 *
 * At the anchor-lift boundary the orchestrator appends model-only scaffolding —
 * `<system-reminder>…</system-reminder>` blocks — directly onto messages in
 * `messageHistory` (deliverLiftNudge / deliverDeferredCorpusAtLift /
 * deliverLiftPlanAtLift). Those reminders are the CORRECT channel to steer the
 * model (the next request is built from messageHistory), but they must NEVER
 * reach a human: `getMessageHistory()` feeds the TUIs' history view + the session
 * export route. neoncortex (Ink) renders the whole history, so a raw
 * "<system-reminder> Your tool set has expanded…" leaked into the chat as a
 * message bubble (fuzzycortex is append-only so it was immune — but the bug is
 * library-side, in the shared history). This strips the reminders for DISPLAY
 * only, returning sanitized COPIES so the model-facing originals are untouched.
 *
 * Consistent with the existing policy that system-reminder tags are ephemeral and
 * are not persisted as real conversation (CortexOrchestrator user-message path).
 */

const SYSTEM_REMINDER_SPAN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Strip every complete <system-reminder>…</system-reminder> span from a string. */
export function stripSystemReminders(text: string): string {
  if (!text || text.indexOf('<system-reminder>') === -1) return text;
  return text.replace(SYSTEM_REMINDER_SPAN, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Return a display-safe copy of a message-history array: any text block (or
 * string content) carrying a system-reminder span is stripped; a block that
 * becomes empty is dropped. Messages with nothing to strip are returned by
 * reference (no needless copying). The input array and its message objects are
 * never mutated.
 */
export function sanitizeHistoryForDisplay(messages: any[]): any[] {
  return messages.map((msg) => {
    const content = msg?.message?.content;

    // String content (plain user/assistant text).
    if (typeof content === 'string') {
      if (content.indexOf('<system-reminder>') === -1) return msg;
      return { ...msg, message: { ...msg.message, content: stripSystemReminders(content) } };
    }

    if (!Array.isArray(content)) return msg;
    if (!content.some((b: any) => typeof b?.text === 'string' && b.text.indexOf('<system-reminder>') !== -1)) {
      return msg; // nothing to strip — share the reference
    }

    const cleaned: any[] = [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.indexOf('<system-reminder>') !== -1) {
        const stripped = stripSystemReminders(block.text);
        if (stripped.length === 0) continue; // block was ONLY a reminder — drop it
        cleaned.push({ ...block, text: stripped });
      } else {
        cleaned.push(block);
      }
    }
    return { ...msg, message: { ...msg.message, content: cleaned } };
  });
}
