import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const [filePath, groupBy, dateBy, distinctBy, thresholdRaw, offsetRaw, limitRaw, startMonthRaw, endMonthRaw, cachePath] = process.argv.slice(2)
const threshold = Math.max(0, Number(thresholdRaw) || 0)
const offset = Math.max(0, Number(offsetRaw) || 0)
const limit = Math.min(200, Math.max(1, Number(limitRaw) || 100))
const startMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(startMonthRaw || '') ? startMonthRaw : null
const endMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(endMonthRaw || '') ? endMonthRaw : null

function valueText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value !== 'object') return String(value).trim()
  if ('result' in value) return valueText(value.result)
  if ('text' in value) return String(value.text).trim()
  if ('richText' in value) return value.richText.map(part => part.text).join('').trim()
  return ''
}

function monthOf(value) {
  const text = valueText(value)
  const match = text.match(/^(20\d{2})[-/]?(0[1-9]|1[0-2])(?:[-/]?([0-2]\d|3[01]))?/)
  return match ? `${match[1]}-${match[2]}` : null
}

async function main() {
  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
      process.stdout.write(JSON.stringify({ ...cached, offset,
        nextOffset: offset + limit < cached.qualifyingCompanies ? offset + limit : null,
        results: cached.results.slice(offset, offset + limit) }))
      return
    } catch { /* Recompute an incomplete cache entry. */ }
  }
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', entries: 'ignore',
  })
  const counts = new Map()
  const headerInfo = []
  let rowsRead = 0
  let datedRows = 0
  let undatedRows = 0
  let excludedOutOfRange = 0
  let firstMonth = null
  let lastMonth = null
  let distinctPermits = 0
  for await (const sheet of reader) {
    let columns = null
    for await (const row of sheet) {
      if (!columns) {
        const names = new Map()
        row.eachCell({ includeEmpty: false }, cell => names.set(valueText(cell.value).toLowerCase(), cell.col))
        headerInfo.push([...names.keys()])
        const group = names.get(groupBy.toLowerCase())
        const date = names.get(dateBy.toLowerCase())
        const distinct = distinctBy ? names.get(distinctBy.toLowerCase()) : null
        if (group && date && distinctBy && !distinct) {
          throw new Error(`Distinct column ${distinctBy} was not found in a worksheet containing ${groupBy} and ${dateBy}.`)
        }
        columns = group && date ? { group, date, distinct } : false
        continue
      }
      if (!columns) continue
      rowsRead++
      const company = valueText(row.getCell(columns.group).value).replace(/\s+/g, ' ').trim()
      const month = monthOf(row.getCell(columns.date).value)
      if (!company || !month) { undatedRows++; continue }
      if ((startMonth && month < startMonth) || (endMonth && month > endMonth)) { excludedOutOfRange++; continue }
      datedRows++
      if (!firstMonth || month < firstMonth) firstMonth = month
      if (!lastMonth || month > lastMonth) lastMonth = month
      let months = counts.get(company)
      if (!months) { months = new Map(); counts.set(company, months) }
      let permits = months.get(month)
      if (!permits) { permits = new Set(); months.set(month, permits) }
      const permitId = columns.distinct ? valueText(row.getCell(columns.distinct).value) : ''
      const key = permitId || `${sheet.id}:${row.number}`
      if (!permits.has(key)) { permits.add(key); distinctPermits++ }
    }
  }
  if (!datedRows || !firstMonth || !lastMonth) {
    throw new Error(`No month-level dates found in column ${dateBy}. Available headers: ${headerInfo.flat().slice(0, 60).join(', ')}`)
  }
  const periodStart = startMonth || firstMonth
  const periodEnd = endMonth || lastMonth
  if (periodStart > periodEnd) throw new Error('startMonth must be on or before endMonth.')
  const [firstYear, firstNumber] = periodStart.split('-').map(Number)
  const [lastYear, lastNumber] = periodEnd.split('-').map(Number)
  const monthsInWindow = (lastYear - firstYear) * 12 + lastNumber - firstNumber + 1
  const ranked = [...counts.entries()].map(([company, months]) => {
    const permits = [...months.values()].reduce((sum, set) => sum + set.size, 0)
    return { company, permits, monthlyAverage: Number((permits / monthsInWindow).toFixed(2)), activeMonths: months.size,
      qualifies: permits / monthsInWindow > threshold }
  }).filter(row => row.qualifies).sort((a, b) => b.monthlyAverage - a.monthlyAverage || a.company.localeCompare(b.company))
    .map(({ qualifies: _qualifies, ...row }) => row)
  const result = { groupBy, dateBy, distinctBy: distinctBy || null, threshold,
    periodStart, periodEnd, monthsInWindow, rowsRead, datedRows, undatedRows, excludedOutOfRange,
    distinctPermits, totalCompanies: counts.size, qualifyingCompanies: ranked.length,
    results: ranked,
    note: 'Average uses every calendar month in the selected span, including months with zero permits. The date column is identified separately from permit issue date.' }
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 })
    const temporary = `${cachePath}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(result), { mode: 0o600 })
    renameSync(temporary, cachePath)
  }
  process.stdout.write(JSON.stringify({ ...result, offset,
    nextOffset: offset + limit < ranked.length ? offset + limit : null,
    results: ranked.slice(offset, offset + limit) }))
}

main().catch(error => { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
