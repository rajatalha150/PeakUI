import type { NormalizedCsvDocument } from './csv-schema'

export function renderCsvDocument(input: NormalizedCsvDocument): Buffer {
  return Buffer.from(input.content, 'utf8')
}
