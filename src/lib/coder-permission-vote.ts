/**
 * Build the wire body for a permission vote (`POST /session/:id/permission/:requestId`).
 *
 * This is ACP's `RequestPermissionResponse`, whose `outcome` is a NESTED
 * discriminated union — not a flat string:
 *
 *   { outcome: { outcome: 'cancelled' } }
 *   { outcome: { outcome: 'selected', optionId: '<id>' } }
 *
 * Sending the flat `{ outcome: 'selected', optionId }` shape is rejected by the
 * daemon with a 400 (\"`outcome` must be `{ outcome: \"cancelled\" }` or
 * `{ outcome: \"selected\", optionId: string }`\"), which the Coding UI surfaced
 * as the dead-end \"That request is no longer pending.\" message — the agent stayed
 * blocked on its permission ask forever.
 *
 * `answers` is a separate TOP-LEVEL key (a sibling of `outcome`). It carries the
 * user's replies to an `ask_user_question` interaction, keyed by each question's
 * `answerKey` (a `\"0\"`, `\"1\"`, … index string), each value being the chosen
 * option's **label**. A permission ask (plain tool approval) omits it.
 */
export interface PermissionVoteBody {
  outcome:
    | { outcome: 'cancelled' }
    | { outcome: 'selected'; optionId: string }
  answers?: Record<string, string>
}

/**
 * Build a vote body.
 *
 * @param optionId - the chosen action optionId (`proceed_once`, `proceed_always`,
 *   …). Omit (or pass empty) to reject/cancel the request.
 * @param answers - for `ask_user_question`, the user's answers keyed by each
 *   question's `answerKey`, values are the chosen option labels. Omit for a
 *   plain permission ask.
 */
export function buildPermissionVoteBody(
  optionId?: string | null,
  answers?: Record<string, string> | null,
): PermissionVoteBody {
  const chosen = typeof optionId === 'string' ? optionId.trim() : ''
  if (!chosen) {
    // A bare `{ outcome: 'cancelled' }` is the only valid rejection shape; an
    // empty `optionId` would be forwarded as a malformed selection.
    return { outcome: { outcome: 'cancelled' } }
  }

  const body: PermissionVoteBody = { outcome: { outcome: 'selected', optionId: chosen } }
  if (answers && Object.keys(answers).length > 0) body.answers = answers
  return body
}
