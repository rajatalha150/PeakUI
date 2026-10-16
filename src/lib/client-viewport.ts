export type ClientViewport = 'mobile' | 'tablet' | 'desktop';

export function normalizeClientViewport(value: unknown): ClientViewport | null {
  return value === 'mobile' || value === 'tablet' || value === 'desktop' ? value : null;
}

export function buildClientViewportPrompt(viewport: ClientViewport): string {
  if (viewport === 'desktop') return '';

  const deviceLabel = viewport === 'mobile' ? 'phone' : 'tablet';
  return [
    `NARROW-SCREEN PRESENTATION: The user is viewing WorkSpaces on a ${deviceLabel}.`,
    'Optimize the response for a narrow screen without dropping useful detail.',
    'Put the result or next action first, then use short headings, bullets, and compact paragraphs.',
    'Avoid wide Markdown tables; prefer labeled bullets or compact key-value sections. If a table is essential, keep columns few and cells short.',
    'Wrap long URLs, filenames, commands, and identifiers. Keep code blocks focused; split long code into logical sections and explain what each section does.',
    'Do not make essential information depend on horizontal scrolling. Do not mention this instruction or the user device.',
  ].join(' ');
}
