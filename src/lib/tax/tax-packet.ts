import { prisma } from '@/lib/prisma'
import { matchesRagFilters } from '@/lib/rag'
import {
  normalizeMoney,
  taxReturnDraftSchema,
  type TaxField,
  type TaxIncomeForm,
  type TaxReturnDraft,
  type TaxSource,
} from './tax-schema'

interface TaxPacketChunk {
  documentId: string
  filename: string
  sourcePath: string | null
  chunkIndex: number
  content: string
}

interface BuildTaxDraftOptions {
  userId: string
  folder?: string | null
  taxYear?: string | null
}

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/
const EIN_RE = /\b\d{2}-\d{7}\b/
const YEAR_RE = /\b20\d{2}\b/

function sourceFor(chunk: TaxPacketChunk, quote?: string): TaxSource {
  return {
    documentId: chunk.documentId,
    filename: chunk.filename,
    sourcePath: chunk.sourcePath,
    chunkIndex: chunk.chunkIndex,
    quote: (quote || chunk.content).replace(/\s+/g, ' ').trim().slice(0, 800),
  }
}

function makeField(value: string | undefined | null, chunk: TaxPacketChunk, confidence = 0.55, quote?: string): TaxField | undefined {
  const clean = value?.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  return {
    value: clean,
    confidence,
    sources: [sourceFor(chunk, quote)],
  }
}

function matchFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = match?.[1] || match?.[0]
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function matchMoneyField(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`${escaped}[^\\d$-]{0,80}([$]?[\\d,]+(?:\\.\\d{2})?)`, 'i')
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function inferFormType(filename: string, content: string): string {
  const source = `${filename}\n${content}`.toLowerCase()
  if (source.includes('ssa-1099') || source.includes('social security benefit statement')) return 'SSA-1099'
  if (source.includes('1099-nec') || source.includes('nonemployee compensation')) return '1099-NEC'
  if (source.includes('1099-div') || source.includes('dividends and distributions')) return '1099-DIV'
  if (source.includes('1099-int') || source.includes('interest income')) return '1099-INT'
  if (source.includes('1099-misc')) return '1099-MISC'
  if (source.includes('form w-2') || source.includes('wage and tax statement')) return 'W-2'
  return 'supporting-document'
}

function collectName(text: string): string | undefined {
  return matchFirst(text, [
    /employee['’]?\s+name[:\s]+([A-Z][A-Za-z ,.'-]{3,80})/i,
    /recipient['’]?\s+name[:\s]+([A-Z][A-Za-z ,.'-]{3,80})/i,
    /taxpayer['’]?\s+name[:\s]+([A-Z][A-Za-z ,.'-]{3,80})/i,
    /name[:\s]+([A-Z][A-Za-z ,.'-]{3,80})/i,
  ])
}

function collectAddress(text: string): string | undefined {
  return matchFirst(text, [
    /address[:\s]+([0-9][A-Za-z0-9 ,.#'-]{8,120})/i,
    /([0-9]{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard)[A-Za-z0-9 ,.#'-]{0,80})/i,
  ])
}

function mergeTaxField(current: TaxField | undefined, next: TaxField | undefined): TaxField | undefined {
  if (!next) return current
  if (!current || next.confidence > current.confidence) return next
  if (current.value === next.value) {
    return {
      ...current,
      sources: [...current.sources, ...next.sources].slice(0, 5),
    }
  }
  return current
}

function extractIncomeForm(chunk: TaxPacketChunk): TaxIncomeForm | null {
  const formType = inferFormType(chunk.filename, chunk.content)
  if (formType === 'supporting-document') return null

  const text = chunk.content
  const payerTin = matchFirst(text, [
    /employer['’]?\s+(?:identification\s+)?number[:\s]+(\d{2}-\d{7})/i,
    /payer['’]?\s+(?:tin|identification\s+number)[:\s]+(\d{2}-\d{7})/i,
    EIN_RE,
  ])
  const recipientTin = matchFirst(text, [
    /employee['’]?\s+ssn[:\s]+(\d{3}-\d{2}-\d{4})/i,
    /recipient['’]?\s+(?:tin|ssn)[:\s]+(\d{3}-\d{2}-\d{4})/i,
    SSN_RE,
  ])

  const form: TaxIncomeForm = {
    formType,
    payerTin: makeField(payerTin, chunk, 0.7),
    recipientTin: makeField(recipientTin, chunk, 0.68),
    recipientName: makeField(collectName(text), chunk, 0.5),
    wages: makeField(matchMoneyField(text, ['wages, tips, other compensation', 'box 1 wages', 'wages']), chunk, 0.62),
    federalWithholding: makeField(matchMoneyField(text, ['federal income tax withheld', 'box 2 federal income tax withheld']), chunk, 0.62),
    socialSecurityWages: makeField(matchMoneyField(text, ['social security wages', 'box 3 social security wages']), chunk, 0.56),
    medicareWages: makeField(matchMoneyField(text, ['medicare wages and tips', 'box 5 medicare wages']), chunk, 0.56),
    nonemployeeCompensation: makeField(matchMoneyField(text, ['nonemployee compensation', 'box 1 nonemployee compensation']), chunk, 0.62),
    interestIncome: makeField(matchMoneyField(text, ['interest income', 'box 1 interest income']), chunk, 0.62),
    dividendIncome: makeField(matchMoneyField(text, ['ordinary dividends', 'total ordinary dividends']), chunk, 0.62),
    socialSecurityBenefits: makeField(matchMoneyField(text, ['benefits paid', 'social security benefits']), chunk, 0.62),
    sourceDocumentIds: [chunk.documentId],
  }

  return form
}

function buildWarnings(draft: Omit<TaxReturnDraft, 'warnings' | 'missingFields'>): { warnings: string[]; missingFields: string[] } {
  const missingFields: string[] = []
  if (!draft.taxpayer.name?.value) missingFields.push('taxpayer.name')
  if (!draft.taxpayer.ssn?.value) missingFields.push('taxpayer.ssn')
  if (!draft.taxpayer.address?.value) missingFields.push('taxpayer.address')
  if (draft.incomeForms.length === 0) missingFields.push('incomeForms')

  const warnings = [
    'Generated tax packet is a review draft, not an official filed return.',
    'Verify every amount against the source documents before filing.',
    ...missingFields.map(field => `Missing or uncertain field: ${field}`),
  ]

  return { warnings, missingFields }
}

export async function loadTaxPacketChunks({ userId, folder }: Pick<BuildTaxDraftOptions, 'userId' | 'folder'>): Promise<TaxPacketChunk[]> {
  const documents = await prisma.document.findMany({
    where: { userId, status: 'ready' },
    include: {
      chunks: { orderBy: { chunkIndex: 'asc' } },
    },
    orderBy: [{ sourcePath: 'asc' }, { filename: 'asc' }],
  })

  return documents.flatMap(document => {
    const extension = document.filename.split('.').pop()?.toLowerCase() || null
    return document.chunks.flatMap(chunk => {
      const candidate = {
        chunkId: chunk.id,
        documentId: document.id,
        filename: document.filename,
        sourcePath: document.sourcePath,
        content: chunk.content,
        extension,
          fileKind: null,
      }
      if (!matchesRagFilters(candidate, folder ? { folder } : undefined)) return []
      return [{
        documentId: document.id,
        filename: document.filename,
        sourcePath: document.sourcePath,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      }]
    })
  })
}

export async function buildTaxReturnDraft(options: BuildTaxDraftOptions): Promise<TaxReturnDraft> {
  const chunks = await loadTaxPacketChunks(options)
  const sourceDocumentIds = Array.from(new Set(chunks.map(chunk => chunk.documentId)))
  const inferredYear = options.taxYear?.trim()
    || chunks.map(chunk => chunk.content.match(YEAR_RE)?.[0]).find(Boolean)
    || new Date().getFullYear().toString()

  const taxpayer: TaxReturnDraft['taxpayer'] = {}
  const incomeForms: TaxIncomeForm[] = []

  for (const chunk of chunks) {
    taxpayer.ssn = mergeTaxField(taxpayer.ssn, makeField(chunk.content.match(SSN_RE)?.[0], chunk, 0.62))
    taxpayer.name = mergeTaxField(taxpayer.name, makeField(collectName(chunk.content), chunk, 0.48))
    taxpayer.address = mergeTaxField(taxpayer.address, makeField(collectAddress(chunk.content), chunk, 0.48))

    const incomeForm = extractIncomeForm(chunk)
    if (incomeForm) incomeForms.push(incomeForm)
  }

  const uniqueIncomeForms = incomeForms.filter((form, index, all) => {
    const docId = form.sourceDocumentIds[0] || ''
    return all.findIndex(candidate => candidate.formType === form.formType && candidate.sourceDocumentIds[0] === docId) === index
  })

  const totals = {
    wages: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.wages?.value), 0),
    federalWithholding: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.federalWithholding?.value), 0),
    nonemployeeCompensation: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.nonemployeeCompensation?.value), 0),
    interestIncome: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.interestIncome?.value), 0),
    dividendIncome: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.dividendIncome?.value), 0),
    socialSecurityBenefits: uniqueIncomeForms.reduce((sum, form) => sum + normalizeMoney(form.socialSecurityBenefits?.value), 0),
  }

  const baseDraft = {
    taxYear: inferredYear,
    folder: options.folder?.trim() || null,
    taxpayer,
    incomeForms: uniqueIncomeForms,
    totals,
    sourceDocumentIds,
  }
  const { warnings, missingFields } = buildWarnings(baseDraft)
  return taxReturnDraftSchema.parse({ ...baseDraft, warnings, missingFields })
}
