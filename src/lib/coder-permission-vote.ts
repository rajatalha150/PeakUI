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
 * daemon with a 400 ("`outcome` must be `{ outcome: "cancelled" }` or
 * `{ outcome: "selected", optionId: string }`"), which the Coding UI surfaced as
 * the dead-end "That request is no longer pending." message — the agent stayed
 * blocked on its permission ask forever.
 *
 * `answers` is a separate TOP-LEVEL key (a sibling of `outcome`), keyed by the
 * interaction's `answerKey`. It carries the choice for an `ask_user_question`
 * interaction; permission asks omit it.
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
 * @param optionId - the chosen `optionId`. Omit (or pass an empty string) to
 *   reject/cancel the request instead of selecting an option.
 * @param answerKey - for `ask_user_question` interactions, the key the daemon
 *   expects in `answers`. Ignored for permission asks.
 */
export function buildPermissionVoteBody(
  optionId?: string | null,
  answerKey?: string | null,
): PermissionVoteBody {
  const chosen = typeof optionId === 'string' ? optionId.trim() : ''
  if (!chosen) {
    // A bare `{ outcome: 'cancelled' }` is the only valid rejection shape; an
    // empty `optionId` would be forwarded as a malformed selection.
    return { outcome: { outcome: 'cancelled' } }
  }

  const body: PermissionVoteBody = { outcome: { outcome: 'selected', optionId: chosen } }
  const key = typeof answerKey === 'string' ? answerKey.trim() : ''
  if (key) body.answers = { [key]: chosen }
  return body
}
