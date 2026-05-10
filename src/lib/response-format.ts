export type ResponsePresentationMode = 'general' | 'document' | 'list' | 'table' | 'data' | 'code' | 'file';
export type ResponseDataFormat = 'json' | 'yaml' | 'csv';

export interface ResponsePresentation {
  mode: ResponsePresentationMode;
  subject?: string;
  dataFormat?: ResponseDataFormat;
}

interface PromptMessage {
  role?: unknown;
  content?: unknown;
}

const FILE_OUTPUT_SYSTEM_PROMPT = [
  'When the user asks for a downloadable file, return file content in a fenced code block with a filename marker like `filename="report.md"` for text or `base64 filename="image.png"` for binary.',
  'Only produce base64 binary when explicitly requested.',
].join(' ');

const DOCUMENT_SUBJECT_RULES: Array<{ pattern: RegExp; subject: string }> = [
  { pattern: /\b(resume|résumé|cv|curriculum vitae)\b/i, subject: 'resume' },
  { pattern: /\b(cover letter|letter of interest)\b/i, subject: 'cover letter' },
  { pattern: /\b(email|e-mail)\b/i, subject: 'email' },
  { pattern: /\b(memo|memorandum)\b/i, subject: 'memo' },
  { pattern: /\b(report|white paper)\b/i, subject: 'report' },
  { pattern: /\b(summary|synopsis|brief)\b/i, subject: 'summary' },
  { pattern: /\b(proposal|pitch)\b/i, subject: 'proposal' },
  { pattern: /\b(letter)\b/i, subject: 'letter' },
  { pattern: /\b(profile|bio|biography|about me)\b/i, subject: 'profile' },
  { pattern: /\b(article|blog post|blog|writeup|write-up)\b/i, subject: 'article' },
  { pattern: /\b(meeting notes?|minutes)\b/i, subject: 'meeting notes' },
  { pattern: /\b(sop|standard operating procedure|procedure|process document)\b/i, subject: 'SOP' },
  { pattern: /\b(document|doc)\b/i, subject: 'document' },
];

function normalizePromptText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getLastUserPrompt(messages: PromptMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim().toLowerCase();
    }
  }

  return '';
}

function isFileRequest(prompt: string): boolean {
  return /\b(download|downloadable|export|save as|save to|file|docx|pdf|markdown file|md file|txt file|json file|csv file|yaml file|yml file|base64)\b/i.test(prompt)
    || /\bcreate\s+(?:a\s+)?(?:downloadable\s+)?file\b/i.test(prompt)
    || /\bmake\s+(?:a\s+)?file\b/i.test(prompt)
    || /\bgenerate\s+(?:a\s+)?file\b/i.test(prompt);
}

function detectDataFormat(prompt: string): ResponseDataFormat | null {
  if (/\bjson\b/i.test(prompt)) return 'json';
  if (/\byaml\b|\byml\b/i.test(prompt)) return 'yaml';
  if (/\bcsv\b/i.test(prompt)) return 'csv';
  return null;
}

function isTableRequest(prompt: string): boolean {
  return /\b(table|comparison|compare|matrix|spreadsheet|columns?|rows?|side[-\s]?by[-\s]?side)\b/i.test(prompt);
}

function isListRequest(prompt: string): boolean {
  return /\b(list|bullet|bulleted|outline|checklist|steps?|roadmap|agenda|plan|sequence|timeline)\b/i.test(prompt);
}

function detectDocumentSubject(prompt: string): string | null {
  for (const rule of DOCUMENT_SUBJECT_RULES) {
    if (rule.pattern.test(prompt)) return rule.subject;
  }
  return null;
}

function isCodeRequest(prompt: string): boolean {
  return /\b(code|snippet|function|class|script|patch|diff|debug|bug|implementation|ts|tsx|js|jsx|python|sql)\b/i.test(prompt);
}

function buildDocumentPrompt(subject: string | undefined): string {
  const normalizedSubject = subject || 'document';
  const subjectSpecificNotes: Record<string, string> = {
    resume: 'For a resume, use a strong professional summary, core skills, experience, education, and certifications if available.',
    'cover letter': 'For a cover letter, include a tailored opening, supporting body paragraphs, and a concise closing with sign-off.',
    email: 'For an email, include a clear subject line, greeting, concise body, and sign-off.',
    memo: 'For a memo, use a compact header with To, From, Date, and Subject, followed by short focused sections.',
    report: 'For a report, use a title, brief overview, findings, recommendations, and conclusion if relevant.',
    summary: 'For a summary, keep the wording concise and prioritize the key takeaways.',
    proposal: 'For a proposal, include context, goals, approach, deliverables, and next steps when relevant.',
    letter: 'For a letter, use a natural opening, body, and closing that reads cleanly in plain text.',
    profile: 'For a profile, focus on an organized summary of strengths, experience, and highlights.',
    article: 'For an article, use an intro, clear sections, and a closing that reads naturally in plain text.',
    'meeting notes': 'For meeting notes, structure the content with a short summary, action items, and decisions.',
    SOP: 'For an SOP, use a process-oriented structure with clear steps, responsibilities, and notes.',
    document: 'Use plain text with clear section labels and bullet points where they improve scanability.',
  };

  return [
    `The user wants a polished ${normalizedSubject} synthesized from the provided source material.`,
    `Return only the finished ${normalizedSubject}.`,
    'Keep the output presentation-ready and easy to paste into a document editor.',
    'Return only the content — no code fences, JSON, or explanatory preambles.',
    'Use plain text unless the user requested markdown.',
    subjectSpecificNotes[normalizedSubject] || subjectSpecificNotes.document,
    'Omit missing information rather than inventing it.',
  ].join(' ');
}

function buildListPrompt(): string {
  return [
    'The user wants a list, outline, checklist, or step-by-step answer.',
    'Return only the list content with short, clear items.',
    'No code fences or explanatory preambles.',
  ].join(' ');
}

function buildTablePrompt(): string {
  return [
    'The user wants a table or comparison.',
    'Return only the table content with short headers and aligned columns.',
    'Use plain text unless the user requested markdown.',
  ].join(' ');
}

function buildDataPrompt(dataFormat: ResponseDataFormat | null): string {
  const format = dataFormat || 'structured data';
  return [
    `Return only valid ${format}.`,
    'No commentary, no markdown fences, no extra prose.',
    format === 'csv'
      ? 'Use a header row if it improves readability.'
      : 'Make sure the output is syntactically valid and ready to parse.',
  ].join(' ');
}

function buildCodePrompt(): string {
  return [
    'The user wants code or a code-related answer.',
    'Return only the code or patch content requested. No explanatory prose unless explicitly asked.',
  ].join(' ');
}

export function inferResponsePresentation(messages: PromptMessage[]): ResponsePresentation {
  const prompt = getLastUserPrompt(messages);
  if (!prompt) return { mode: 'general' };

  if (isFileRequest(prompt)) return { mode: 'file' };

  const dataFormat = detectDataFormat(prompt);
  if (dataFormat) return { mode: 'data', dataFormat };

  if (isTableRequest(prompt)) return { mode: 'table' };
  if (isListRequest(prompt)) return { mode: 'list' };

  const subject = detectDocumentSubject(prompt);
  if (subject) return { mode: 'document', subject };

  if (isCodeRequest(prompt)) return { mode: 'code' };

  return { mode: 'general' };
}

export function normalizeResponsePresentation(value: unknown): ResponsePresentation {
  if (!value || typeof value !== 'object') return { mode: 'general' };

  const presentation = value as Partial<ResponsePresentation>;
  const mode = presentation.mode;
  if (mode !== 'document' && mode !== 'list' && mode !== 'table' && mode !== 'data' && mode !== 'code' && mode !== 'file') {
    return { mode: 'general' };
  }

  if (mode === 'data') {
    const dataFormat = presentation.dataFormat === 'json' || presentation.dataFormat === 'yaml' || presentation.dataFormat === 'csv'
      ? presentation.dataFormat
      : undefined;
    return { mode, dataFormat };
  }

  return {
    mode,
    subject: typeof presentation.subject === 'string' ? presentation.subject : undefined,
  };
}

export function buildResponsePresentationPrompt(presentation: ResponsePresentation): string {
  switch (presentation.mode) {
    case 'file':
      return FILE_OUTPUT_SYSTEM_PROMPT;
    case 'document':
      return buildDocumentPrompt(presentation.subject);
    case 'list':
      return buildListPrompt();
    case 'table':
      return buildTablePrompt();
    case 'data':
      return buildDataPrompt(presentation.dataFormat ?? null);
    case 'code':
      return buildCodePrompt();
    case 'general':
    default:
      return '';
  }
}

export function getResponseDownloadExtension(presentation: ResponsePresentation): string {
  switch (presentation.mode) {
    case 'data':
      return presentation.dataFormat || 'txt';
    default:
      return 'txt';
  }
}

export function getResponseDownloadMimeType(presentation: ResponsePresentation): string {
  switch (presentation.mode) {
    case 'data':
      switch (presentation.dataFormat) {
        case 'json':
          return 'application/json';
        case 'yaml':
          return 'application/yaml';
        case 'csv':
          return 'text/csv';
        default:
          return 'text/plain';
      }
    default:
      return 'text/plain';
  }
}

export function getLastPromptForDebug(messages: PromptMessage[]): string {
  return normalizePromptText(getLastUserPrompt(messages));
}
