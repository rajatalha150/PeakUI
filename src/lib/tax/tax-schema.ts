import { z } from 'zod'

export const taxSourceSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  sourcePath: z.string().nullable().optional(),
  chunkIndex: z.number().int().nullable().optional(),
  quote: z.string().max(800),
})

export const taxFieldSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  sources: z.array(taxSourceSchema).default([]),
})

export const taxIncomeFormSchema = z.object({
  formType: z.string(),
  payerName: taxFieldSchema.optional(),
  payerTin: taxFieldSchema.optional(),
  recipientName: taxFieldSchema.optional(),
  recipientTin: taxFieldSchema.optional(),
  wages: taxFieldSchema.optional(),
  federalWithholding: taxFieldSchema.optional(),
  socialSecurityWages: taxFieldSchema.optional(),
  medicareWages: taxFieldSchema.optional(),
  nonemployeeCompensation: taxFieldSchema.optional(),
  interestIncome: taxFieldSchema.optional(),
  dividendIncome: taxFieldSchema.optional(),
  socialSecurityBenefits: taxFieldSchema.optional(),
  sourceDocumentIds: z.array(z.string()).default([]),
})

export const taxReturnDraftSchema = z.object({
  taxYear: z.string(),
  folder: z.string().nullable(),
  taxpayer: z.object({
    name: taxFieldSchema.optional(),
    ssn: taxFieldSchema.optional(),
    address: taxFieldSchema.optional(),
  }),
  spouse: z.object({
    name: taxFieldSchema.optional(),
    ssn: taxFieldSchema.optional(),
  }).optional(),
  incomeForms: z.array(taxIncomeFormSchema).default([]),
  totals: z.object({
    wages: z.number().default(0),
    federalWithholding: z.number().default(0),
    nonemployeeCompensation: z.number().default(0),
    interestIncome: z.number().default(0),
    dividendIncome: z.number().default(0),
    socialSecurityBenefits: z.number().default(0),
  }),
  warnings: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  sourceDocumentIds: z.array(z.string()).default([]),
})

export type TaxSource = z.infer<typeof taxSourceSchema>
export type TaxField = z.infer<typeof taxFieldSchema>
export type TaxIncomeForm = z.infer<typeof taxIncomeFormSchema>
export type TaxReturnDraft = z.infer<typeof taxReturnDraftSchema>

export function normalizeMoney(value: string | undefined | null): number {
  if (!value) return 0
  const normalized = value.replace(/[$,\s]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}
