import { describe, expect, it } from 'vitest'
import { buildPythonGuardScript } from './workspace-tool-code-execution'

describe('buildPythonGuardScript', () => {
  it('interpolates the real exception message (not literal {e})', () => {
    const script = buildPythonGuardScript()

    // The generated Python must use single braces so f-strings interpolate the
    // actual exception. A regression here emits `{{e}}`, which Python renders as
    // the literal text "{e}" and swallows the real error — the user then sees
    // the useless "Error: {e}" instead of the underlying failure.
    expect(script).toContain("print(f'SecurityError: {e}', file=sys.stderr)")
    expect(script).toContain("print(f'Error: {e}', file=sys.stderr)")
    expect(script).not.toContain('{{e}}')
  })
})
