import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PDFForm, PDFDocument } from 'pdf-lib'

const execFileAsync = promisify(execFile)

/**
 * IRS forms reference catalog.
 *
 * The Accountant mode exposes the official IRS form PDFs that ship with the
 * app (the `irs_forms/` directory) so the agent can pick a form, inspect its
 * fillable AcroForm fields, and fill it for a client. The forms live as static
 * files on disk; this module scans the directory lazily and caches the result.
 *
 * Nothing here touches user/Knowledge-Base data — it is a read-only catalog of
 * public IRS forms. Path parameters are strictly validated to prevent traversal
 * outside the configured forms directory.
 */

export interface IrsFormSummary {
  formId: string
  filename: string
  title: string
  sizeBytes: number
}

export interface IrsFormField {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'other'
}

export interface IrsFormDetail extends IrsFormSummary {
  fields: IrsFormField[]
  fieldCount: number
  /** First-page visible text (labels/line items) extracted via pdftotext. */
  pageText: string
  warnings: string[]
}

const DEFAULT_IRS_FORMS_DIR = path.join(process.cwd(), 'irs_forms')

export function getIrsFormsDir(): string {
  const env = process.env.IRS_FORMS_DIR
  return env && env.trim() ? path.resolve(env.trim()) : DEFAULT_IRS_FORMS_DIR
}

/**
 * Human-readable titles for the most commonly used IRS forms. Falls back to the
 * formId for anything not listed; the agent can call `inspectIrsForm` to read
 * the real title and line labels from the form's first page.
 */
const FORM_TITLE_MAP: Record<string, string> = {
  f1024: 'Form 1024 — Application for Recognition of Exemption',
  f1040: 'Form 1040 — U.S. Individual Income Tax Return',
  f1040es: 'Form 1040-ES — Estimated Tax for Individuals',
  f1040nr: 'Form 1040-NR — U.S. Nonresident Alien Income Tax Return',
  f1040s1: 'Schedule 1 (Form 1040) — Additional Income and Adjustments',
  f1040s2: 'Schedule 2 (Form 1040) — Additional Taxes',
  f1040s3: 'Schedule 3 (Form 1040) — Additional Credits and Payments',
  f1040sa: 'Schedule A (Form 1040) — Itemized Deductions',
  f1040sb: 'Schedule B (Form 1040) — Interest and Ordinary Dividends',
  f1040sc: 'Schedule C (Form 1040) — Profit or Loss From Business',
  f1040sd: 'Schedule D (Form 1040) — Capital Gains and Losses',
  f1040se: 'Schedule E (Form 1040) — Supplemental Income and Loss',
  f1040sf: 'Schedule F (Form 1040) — Profit or Loss From Farming',
  f1040sh: 'Schedule H (Form 1040) — Household Employment Taxes',
  f1040sj: 'Schedule J (Form 1040) — Income Averaging for Farmers/Fishermen',
  f1040sr: 'Form 1040-SR — U.S. Tax Return for Seniors',
  f1040sr_sched: 'Schedule (Form 1040-SR)',
  f1040sse: 'Schedule SE (Form 1040) — Self-Employment Tax',
  f1040ss: 'Schedule SS',
  f1040v: 'Form 1040-V — Payment Voucher',
  f1040x: 'Form 1040-X — Amended U.S. Individual Income Tax Return',
  f1041: 'Form 1041 — U.S. Income Tax Return for Estates and Trusts',
  f1065: 'Form 1065 — U.S. Return of Partnership Income',
  f1096: 'Form 1096 — Annual Summary and Transmittal of U.S. Information Returns',
  f1098: 'Form 1098 — Mortgage Interest Statement',
  f1098c: 'Form 1098-C — Contributions of Motor Vehicles, Boats, and Airplanes',
  f1098e: 'Form 1098-E — Student Loan Interest Statement',
  f1099a: 'Form 1099-A — Acquisition or Abandonment of Secured Property',
  f1099g: 'Form 1099-G — Certain Government Payments',
  f1099s: 'Form 1099-S — Proceeds From Real Estate Transactions',
  f1120: 'Form 1120 — U.S. Corporation Income Tax Return',
  f1310: 'Form 1310 — Statement of Person Claiming Refund Due a Deceased Taxpayer',
  f433a: 'Form 433-A — Collection Information Statement for Wage Earners',
  f433f: 'Form 433-F — Collection Information Statement',
  f4506: 'Form 4506 — Request for Copy of Tax Return',
  f4506t: 'Form 4506-T — Request for Transcript of Tax Return',
  f4684: 'Form 4684 — Casualties and Thefts',
  f5695: 'Form 5695 — Residential Energy Credits',
  f8863: 'Form 8863 — Education Credits',
  f8919: 'Form 8919 — Uncollected Social Security and Medicare Tax',
  f8960: 'Form 8960 — Net Investment Income Tax',
  f941: 'Form 941 — Employer QUARTERLY Federal Tax Return',
  f943: 'Form 943 — Employer Annual Federal Tax Return for Agricultural Employees',
  f990t: 'Form 990-T — Exempt Organization Business Income Tax Return',
  fw3: 'Form W-3 — Transmittal of Wage and Tax Statements',
}

function titleForFormId(formId: string): string {
  return FORM_TITLE_MAP[formId] || formId
}

const FORM_ID_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Resolve a user-supplied formId to an absolute PDF path inside the forms dir,
 * rejecting anything that could escape the directory. Returns null when the
 * formId is malformed or the resolved path is not strictly within the dir.
 */
export function resolveIrsFormPath(formId: string, dir = getIrsFormsDir()): string | null {
  const trimmed = formId.trim().replace(/\.pdf$/i, '')
  if (!trimmed || !FORM_ID_RE.test(trimmed)) return null
  const candidate = path.join(dir, `${trimmed}.pdf`)
  // Defend against `..` or absolute inputs even though FORM_ID_RE already
  // blocks them — belt and braces.
  const rel = path.relative(dir, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return candidate
}

let cachedSummaries: IrsFormSummary[] | null = null

export async function listIrsForms(): Promise<IrsFormSummary[]> {
  if (cachedSummaries) return cachedSummaries
  const dir = getIrsFormsDir()
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    cachedSummaries = []
    return cachedSummaries
  }

  const summaries: IrsFormSummary[] = []
  for (const filename of entries.sort()) {
    if (!filename.toLowerCase().endsWith('.pdf')) continue
    const formId = filename.replace(/\.pdf$/i, '')
    const full = path.join(dir, filename)
    try {
      const stat = await fs.stat(full)
      if (!stat.isFile()) continue
      summaries.push({
        formId,
        filename,
        title: titleForFormId(formId),
        sizeBytes: stat.size,
      })
    } catch {
      // Skip unreadable files.
    }
  }

  cachedSummaries = summaries
  return summaries
}

const inspectCache = new Map<string, IrsFormDetail>()

function describeField(form: PDFForm, name: string): IrsFormField['type'] {
  try { form.getTextField(name); return 'text' } catch { /* not text */ }
  try { form.getCheckBox(name); return 'checkbox' } catch { /* not checkbox */ }
  try { form.getRadioGroup(name); return 'radio' } catch { /* not radio */ }
  try { form.getDropdown(name); return 'dropdown' } catch { /* not dropdown */ }
  try { form.getOptionList(name); return 'optionlist' } catch { /* not optionlist */ }
  return 'other'
}

async function extractFirstPageText(pdfPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-f', '1', '-l', '1', '-layout', pdfPath, '-'], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
    })
    return stdout.replace(/\r/g, '').trim().slice(0, 4000)
  } catch {
    return ''
  }
}

export async function inspectIrsForm(formId: string): Promise<IrsFormDetail> {
  const key = formId.trim().replace(/\.pdf$/i, '').toLowerCase()
  const cached = inspectCache.get(key)
  if (cached) return cached

  const dir = getIrsFormsDir()
  const pdfPath = resolveIrsFormPath(formId, dir)
  if (!pdfPath) {
    throw new Error(`Unknown IRS form id: ${formId}`)
  }

  let bytes: Buffer
  try {
    bytes = await fs.readFile(pdfPath)
  } catch {
    throw new Error(`IRS form file not found: ${formId}`)
  }

  const warnings: string[] = []
  const fields: IrsFormField[] = []

  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const form = pdfDoc.getForm()
    if (form.hasXFA()) {
      warnings.push('This form contains XFA data; pdf-lib fills AcroForm fields only.')
    }
    for (const field of form.getFields()) {
      const name = field.getName()
      if (!name) continue
      fields.push({ name, type: describeField(form, name) })
    }
  } catch {
    warnings.push('Could not read AcroForm fields from this PDF (it may be flattened or unsupported).')
  }

  const pageText = await extractFirstPageText(pdfPath)
  const formIdClean = formId.trim().replace(/\.pdf$/i, '')

  const detail: IrsFormDetail = {
    formId: formIdClean,
    filename: `${formIdClean}.pdf`,
    title: titleForFormId(formIdClean),
    sizeBytes: bytes.byteLength,
    fields,
    fieldCount: fields.length,
    pageText,
    warnings,
  }
  inspectCache.set(key, detail)
  return detail
}

export async function loadIrsFormPdf(formId: string): Promise<Buffer> {
  const dir = getIrsFormsDir()
  const pdfPath = resolveIrsFormPath(formId, dir)
  if (!pdfPath) {
    throw new Error(`Unknown IRS form id: ${formId}`)
  }
  try {
    return await fs.readFile(pdfPath)
  } catch {
    throw new Error(`IRS form file not found: ${formId}`)
  }
}