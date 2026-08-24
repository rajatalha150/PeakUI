import type { ResponsePresentation } from '@/lib/response-format';
import { stripAllToolTags } from '@/lib/workspace-tool-tools';

function stripToolTags(content: string): string {
  return stripAllToolTags(content);
}

const DOCUMENT_HEADING_KEYWORDS = /\b(summary|overview|experience|work history|education|skills|competencies|certifications|projects|achievements|profile|objective|about me|highlights|responsibilities|recommendations|findings|conclusion|next steps|action items|meeting notes|agenda|background|scope|contact|contact information|references)\b/i;

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function stripTrailingWhitespace(content: string): string {
  return content.replace(/[ \t]+$/gm, '');
}

function shouldStripOuterFence(info: string, presentation?: ResponsePresentation): boolean {
  const label = info.trim().toLowerCase();

  if (presentation?.mode === 'code' || presentation?.mode === 'file') {
    return false;
  }

  switch (presentation?.mode) {
    case 'document':
      return !label || /^(markdown|md|text|plaintext|plain|document|doc|resume|cv|cover letter|letter|email|memo|report|summary|proposal|article|blog|notes|meeting notes|outline|list|table|comparison|answer|response)$/i.test(label);
    case 'list':
      return !label || /^(markdown|md|text|plaintext|plain|list|outline|bullet|bullets|checklist)$/i.test(label);
    case 'table':
      return !label || /^(markdown|md|text|plaintext|plain|table)$/i.test(label);
    case 'data':
      return !label || /^(markdown|md|text|plaintext|plain|json|yaml|yml|csv)$/i.test(label);
    case 'general':
    default:
      return /^(markdown|md|text|plaintext|plain)$/i.test(label);
  }
}

function stripOuterFence(content: string, presentation?: ResponsePresentation): string {
  const lines = content.split('\n');
  const firstContentIndex = lines.findIndex(line => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return content;
  }

  const firstLine = lines[firstContentIndex].trim();
  if (!firstLine.startsWith('```')) {
    return content;
  }

  const info = firstLine.slice(3).trim();
  if (!shouldStripOuterFence(info, presentation)) {
    return content;
  }

  const withoutOpeningFence = lines.slice(firstContentIndex + 1);
  let closingIndex = -1;

  for (let index = withoutOpeningFence.length - 1; index >= 0; index -= 1) {
    if (withoutOpeningFence[index].trim().length > 0) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex !== -1 && withoutOpeningFence[closingIndex].trim().startsWith('```')) {
    withoutOpeningFence.splice(closingIndex, 1);
  }

  return withoutOpeningFence.join('\n').trim();
}

function normalizeListMarker(line: string): string {
  return line
    .replace(/^(\s*)[•·]\s+/, '$1- ')
    .replace(/^(\s*)(\d+)[)\]]\s+/, '$1$2. ')
    .replace(/^(\s*)(\d+)\s+[-–—]\s+/, '$1$2. ');
}

function isLikelyDocumentHeading(line: string): boolean {
  const trimmed = line.trim().replace(/:$/, '');
  if (!trimmed) return false;
  if (trimmed.length > 80) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (/[|@/#\\]/.test(trimmed)) return false;
  if (/\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  if (words.length > 6) return false;

  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;

  if (trimmed === trimmed.toUpperCase()) {
    return true;
  }

  const titleCase = words.every(word => {
    const clean = word.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!clean) return true;
    if (/^(and|or|of|the|for|to|in|on|at|with|by|from)$/i.test(clean)) return true;
    return /^[A-Z][A-Za-z0-9&'/-]*$/.test(clean) || /^[A-Z]{2,}$/.test(clean);
  });

  return titleCase && DOCUMENT_HEADING_KEYWORDS.test(trimmed);
}

function normalizeDocumentHeadings(content: string, presentation?: ResponsePresentation): string {
  if (presentation?.mode !== 'document') {
    return content;
  }

  const lines = content.split('\n');
  const output: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      output.push(rawLine);
      continue;
    }

    if (!inFence) {
      const normalizedLine = normalizeListMarker(rawLine);
      if (isLikelyDocumentHeading(normalizedLine)) {
        output.push(`## ${normalizedLine.trim().replace(/:$/, '')}`);
        continue;
      }

      output.push(normalizedLine);
      continue;
    }

    output.push(rawLine);
  }

  return output.join('\n');
}

function splitTableCells(line: string, delimiter: 'pipe' | 'tab'): string[] {
  if (delimiter === 'tab') {
    return line.split(/\t+/).map(cell => cell.trim());
  }

  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableCells(line, 'pipe');
  return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function looksLikeTableContent(lines: string[], delimiter: 'pipe' | 'tab'): boolean {
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);
  if (nonEmptyLines.length < 2) return false;
  if (!nonEmptyLines.every(line => delimiter === 'pipe' ? line.includes('|') : line.includes('\t'))) {
    return false;
  }
  return nonEmptyLines.some(line => splitTableCells(line, delimiter).length >= 2);
}

function normalizeTableContent(content: string, presentation?: ResponsePresentation): string {
  if (presentation?.mode === 'code' || presentation?.mode === 'file') {
    return content;
  }

  if (content.includes('```')) {
    return content;
  }

  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);
  const delimiter: 'pipe' | 'tab' | null = looksLikeTableContent(nonEmptyLines, 'tab')
    ? 'tab'
    : looksLikeTableContent(nonEmptyLines, 'pipe')
      ? 'pipe'
      : null;

  if (!delimiter) {
    return content;
  }

  const tableLines = nonEmptyLines.filter(line => !isTableSeparatorRow(line));
  const rows = tableLines.map(line => splitTableCells(line, delimiter)).filter(row => row.length >= 2);
  if (rows.length < 2) {
    return content;
  }

  const width = Math.max(...rows.map(row => row.length));
  const normalizedRows = rows.map(row => {
    const padded = [...row];
    while (padded.length < width) padded.push('');
    return padded;
  });

  const escapeCell = (value: string) => value.replace(/\|/g, '\\|');
  const toPipeRow = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
  const header = normalizedRows[0];
  const separator = `| ${header.map(() => '---').join(' | ')} |`;

  return [toPipeRow(header), separator, ...normalizedRows.slice(1).map(toPipeRow)].join('\n');
}

export function normalizeAssistantResponseContent(content: string, presentation?: ResponsePresentation): string {
  const toolTagStripped = stripToolTags(content);
  const lineNormalized = stripTrailingWhitespace(normalizeLineEndings(toolTagStripped));
  const unwrapped = stripOuterFence(lineNormalized, presentation);
  const headingNormalized = normalizeDocumentHeadings(unwrapped, presentation);
  const tableNormalized = normalizeTableContent(headingNormalized, presentation);
  return tableNormalized.replace(/\n{3,}/g, '\n\n').trim();
}
