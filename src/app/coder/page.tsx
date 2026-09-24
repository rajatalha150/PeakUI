"use client";

import CodingView from '../components/CodingView';

/**
 * Dedicated route for the Coding surface.
 *
 * Living at its own URL (rather than an in-page view toggle) is what makes the
 * requested behaviour work: the nav opens it in a NEW TAB, a refresh stays on
 * this page (the URL is stable), and the browser back button exits to the main
 * PeakUI interface.
 */
export default function CoderPage() {
  return <CodingView />;
}
