'use client'

import { forwardRef, memo } from 'react'

/**
 * Memoized container that noVNC attaches its `<canvas>` to. The wrapper holds
 * stable DOM identity so React reconciliation in a parent component (which
 * re-renders when the live-browser server broadcasts `page` events roughly
 * once per second) does NOT steal DOM focus from the noVNC canvas.
 *
 * Keeping this component isolated is what fixes the "click glitch" where the
 * user clicks the search bar and the click is undone within ~1 second — that
 * was React reconciliation yanking focus off the canvas back to the wrapper.
 */
const LiveBrowserViewport = memo(
  forwardRef<HTMLDivElement>((_, ref) => (
    <div
      ref={ref}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 200,
        background: '#111',
      }}
    />
  ))
)
LiveBrowserViewport.displayName = 'LiveBrowserViewport'

export default LiveBrowserViewport