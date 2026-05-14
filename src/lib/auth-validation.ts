const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{1,30}[a-zA-Z0-9])?$/
const MIN_PASSWORD_LENGTH = 10
const MAX_PASSWORD_LENGTH = 128

export function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateUsername(value: unknown): string | null {
  const username = normalizeUsername(value)
  if (!username) return 'Username is required.'
  if (username.length < 3 || username.length > 32) {
    return 'Username must be between 3 and 32 characters.'
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username may only contain letters, numbers, dots, underscores, and hyphens.'
  }
  return null
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password is required.'
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include uppercase, lowercase, and numeric characters.'
  }
  return null
}

export function getPasswordPolicyText(): string {
  return `Use ${MIN_PASSWORD_LENGTH}+ characters with uppercase, lowercase, and at least one number.`
}
