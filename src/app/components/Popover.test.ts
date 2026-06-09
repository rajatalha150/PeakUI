import { describe, expect, it } from 'vitest';
import { computePopoverPosition, type PopoverPosition } from './Popover';

const ANCHOR_DEFAULT = { top: 100, bottom: 132, left: 200, right: 320, width: 120, height: 32 };

describe('computePopoverPosition', () => {
  it('drops below the anchor with right alignment by default', () => {
    const result: PopoverPosition = computePopoverPosition(ANCHOR_DEFAULT, 280, 400, 1280, 800);
    // Below the anchor: top = bottom + gap (132 + 6 = 138)
    expect(result.top).toBe(138);
    // Right-aligned: left = right - width (320 - 280 = 40)
    expect(result.left).toBe(40);
    expect(result.side).toBe('bottom');
  });

  it('aligns to the start (left) edge when align="start"', () => {
    const result = computePopoverPosition(ANCHOR_DEFAULT, 280, 400, 1280, 800, { align: 'start' });
    expect(result.left).toBe(ANCHOR_DEFAULT.left);
  });

  it('centers on the anchor when align="center"', () => {
    const result = computePopoverPosition(ANCHOR_DEFAULT, 100, 400, 1280, 800, { align: 'center' });
    // left = anchor.left + (anchor.width - popoverWidth) / 2 = 200 + (120 - 100) / 2 = 210
    expect(result.left).toBe(210);
  });

  it('flips above the anchor when there is no room below', () => {
    // Anchor near the bottom: bottom = 780, gap = 6, popoverHeight = 400,
    // top = 786 which exceeds 800 - 8 = 792. Flip above.
    const anchor = { ...ANCHOR_DEFAULT, top: 380, bottom: 412 };
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800);
    // top = anchor.top - gap - popoverHeight = 380 - 6 - 400 = -26 → not in viewport
    // First check: flipped = -26 which is < margin (8), so it tries the
    // room-above heuristic. roomAbove = 380 - 6 - 8 = 366; roomBelow =
    // 800 - 8 - 412 - 6 = 374. Room below is larger, so we stay below
    // but pin to viewport edge.
    // top = max(8, 800 - 400 - 8) = 392
    expect(result.top).toBe(392);
    expect(result.side).toBe('bottom');
  });

  it('actually flips above the anchor when below overflows and above fits', () => {
    // Anchor near the bottom with very little room below.
    const anchor = { ...ANCHOR_DEFAULT, top: 750, bottom: 782 };
    // bottom (782) + gap (6) + popoverHeight (400) = 1188 > 792.
    // flipped = 750 - 6 - 400 = 344, which is >= margin (8) → flip above.
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800);
    expect(result.top).toBe(344);
    expect(result.side).toBe('top');
  });

  it('respects side="top" and only falls back to bottom if it does not fit', () => {
    const anchor = { ...ANCHOR_DEFAULT, top: 5, bottom: 37 };
    // Forced top: top = 5 - 6 - 400 = -401 < 8 → fall back to bottom.
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800, { side: 'top' });
    expect(result.top).toBe(37 + 6);
    expect(result.side).toBe('bottom');
  });

  it('clamps left to the viewport margin when the popover would overflow the right edge', () => {
    // Anchor near the right edge: right = 1260, width = 280 → right-aligned
    // left = 1260 - 280 = 980. viewport - popover - margin = 1280 - 280 - 8 = 992.
    // 980 < 992 → no clamp needed in this case. Make anchor further right.
    const anchor = { ...ANCHOR_DEFAULT, left: 1100, right: 1260 };
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800);
    // right-aligned left = 1260 - 280 = 980, max = 992 → no clamp.
    expect(result.left).toBe(980);
  });

  it('pins to the left margin when the popover would overflow the left edge', () => {
    // Anchor near the left edge with end alignment.
    const anchor = { ...ANCHOR_DEFAULT, left: 5, right: 100 };
    // right-aligned left = 100 - 280 = -180, < margin (8) → clamp to 8.
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800);
    expect(result.left).toBe(8);
  });

  it('uses a custom gap and margin', () => {
    const result = computePopoverPosition(ANCHOR_DEFAULT, 280, 400, 1280, 800, { gap: 12, margin: 4 });
    expect(result.top).toBe(ANCHOR_DEFAULT.bottom + 12);
    // Right-aligned left = 320 - 280 = 40, no clamp.
    expect(result.left).toBe(40);
  });

  it('handles a popover wider than the viewport by pinning to the left margin', () => {
    const result = computePopoverPosition(ANCHOR_DEFAULT, 2000, 400, 1280, 800);
    // popoverWidth (2000) + 2*margin (16) > viewport (1280) → left = margin.
    expect(result.left).toBe(8);
  });

  it('does not flip a bottom-anchored popover when below has room', () => {
    const anchor = { ...ANCHOR_DEFAULT, top: 50, bottom: 82 };
    // bottom (82) + gap (6) + 400 = 488 < 792 → no flip.
    const result = computePopoverPosition(anchor, 280, 400, 1280, 800);
    expect(result.top).toBe(88);
    expect(result.side).toBe('bottom');
  });
});
