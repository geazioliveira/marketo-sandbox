// A hook's input and output, for the four hooks of the loop (#5).
//
// Claude Code hands a hook one JSON object on stdin and reads its decision
// from one JSON object on stdout. These hooks only restrict: a decision is
// deny, ask or pass, and pass prints nothing, so Claude Code's own
// permission rules still decide. None of them ever prints `allow`, which
// would skip the permission prompt the person relies on.
//
// A critical ask is one whose whole point is that a person looks before it
// happens (a merge, a harness edit, a plan not yet posted). In the modes
// where nobody is asked, an ask would pass unseen, so there it becomes a
// deny.

/** Every reason a person reads starts with this, so they know which hook spoke. */
export const hookTag = '[hooks do loop, #5]'

/** Permission modes in which an ask reaches no person. */
export const autonomousModes = ['bypassPermissions', 'dontAsk', 'auto']

/**
 * Reads stdin whole and parses it; null when it is not a JSON object.
 * The bytes are decoded once, at the end: a chunk boundary may split a
 * multi-byte character, and an accented pt-BR body is common here.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readInput(stream = process.stdin) {
  const chunks = []
  try {
    for await (const chunk of stream)
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  } catch {
    return null
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

/** A decision: { decision: 'deny' | 'ask' | 'pass', reason?: string, critical?: boolean } */
export const pass = () => ({ decision: 'pass' })
export const deny = (reason) => ({ decision: 'deny', reason })
export const ask = (reason, { critical = false } = {}) => ({
  decision: 'ask',
  reason,
  critical,
})

/**
 * The rank of a decision. Anything that is not one of the three shapes
 * outranks them all: a rule that returned something malformed is a bug, and
 * a bug must not let the command through.
 */
function rank(decision) {
  if (decision == null || decision.decision === 'pass') return 0
  if (decision.decision === 'ask') return decision.critical === true ? 2 : 1
  if (decision.decision === 'deny') return 3
  return 4
}

const malformed = 'uma regra do hook devolveu uma decisão desconhecida'

/**
 * deny > critical ask > ask > pass; reasons of the winning level joined with
 * ' ' in order. A missing entry (null or undefined) counts as pass, and a
 * reason repeated by two commands of one line is said once.
 */
export function combine(decisions) {
  const list = [...(decisions ?? [])]
  const top = list.reduce((best, decision) => Math.max(best, rank(decision)), 0)
  if (top === 0) return pass()
  const reasons = []
  for (const decision of list) {
    if (rank(decision) !== top) continue
    const reason = top === 4 ? malformed : String(decision.reason ?? '').trim()
    if (reason !== '' && !reasons.includes(reason)) reasons.push(reason)
  }
  const reason = reasons.join(' ')
  if (top === 1) return ask(reason)
  if (top === 2) return ask(reason, { critical: true })
  return deny(reason)
}

/**
 * A critical ask becomes deny in autonomousModes, with this suffix appended:
 * ` Em ${mode}, a confirmação vira negação: faça isso fora desse modo.`
 * Every other decision is returned as it is.
 */
export function resolve(decision, permissionMode) {
  if (
    decision?.decision === 'ask' &&
    decision.critical === true &&
    autonomousModes.includes(permissionMode)
  )
    return deny(
      `${String(decision.reason ?? '').trim()} Em ${permissionMode}, a confirmação vira negação: faça isso fora desse modo.`.trim(),
    )
  return decision
}

/**
 * The PreToolUse stdout for a resolved decision, or '' for pass. Reason
 * prefixed with hookTag. Only deny and ask are ever printed; anything else
 * that is not a pass (an `allow` included) is printed as a deny, since this
 * hook never grants what Claude Code's own rules would ask about.
 */
export function preToolUseOutput(decision) {
  const kind = decision?.decision
  if (kind === 'pass') return ''
  const known = kind === 'deny' || kind === 'ask'
  const reason = known ? String(decision.reason ?? '').trim() : malformed
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: known ? kind : 'deny',
      permissionDecisionReason:
        reason === '' ? hookTag : `${hookTag} ${reason}`,
    },
  })
}

/** { hookSpecificOutput: { hookEventName: event, additionalContext: text } } as a string. */
export function contextOutput(event, text) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  })
}
