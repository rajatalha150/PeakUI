# Excel Workbook Workflow

PeakUI can create downloadable Excel workbook artifacts from WorkSpaces through the `workbook_document` tool.

## What It Does

- Accepts a title, filename, template, metadata, and one or more structured sheets.
- Renders a real `.xlsx` workbook with styled titles, typed columns, formatted values, filters, frozen headers, notes, and total formulas.
- Stores the generated workbook as a Canvas artifact tied to the current WorkSpaces session.
- Stores a sibling `.source.json` artifact in the same bundle so the source contract can be inspected or regenerated later.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `workbook_document` when the user asks for an Excel file, XLSX, spreadsheet, workbook, budget, invoice workbook, timesheet, ledger, inventory, tracker, schedule, or multi-sheet analysis.

Do not use markdown tables, shell, filesystem, or the code sandbox for normal workbook generation unless the user explicitly asks to write source code or save files in a workspace path.

## Professional Workbook Rules

- Treat workbooks as structured spreadsheet deliverables, not markdown transcripts.
- Use separate `sheets` for separate subjects.
- Use typed `columns` for dates, numbers, currency, percentages, booleans, and text.
- Put records in `rows`, summaries in additional `tables`, assumptions in `notes`, and calculations in `totals`.
- After generation succeeds, present the download link first and keep the chat response concise unless the user asks for an inline summary.

## Tool Contract

```xml
<openclaw_tool name="workbook_document">
{"title":"Project Budget","filename":"project-budget.xlsx","template":"budget","sheets":[{"name":"Budget","title":"Project Budget","columns":[{"header":"Category","type":"text"},{"header":"Planned","type":"currency"},{"header":"Actual","type":"currency"},{"header":"Variance","type":"currency"}],"rows":[{"Category":"Hosting","Planned":500,"Actual":425,"Variance":75},{"Category":"Support","Planned":1200,"Actual":1100,"Variance":100}],"tables":[{"title":"Summary","columns":[{"header":"Metric","type":"text"},{"header":"Amount","type":"currency"}],"rows":[{"Metric":"Total Planned","Amount":1700},{"Metric":"Total Actual","Amount":1525}]}],"notes":["Currency: USD"],"freezeHeader":true,"autoFilter":true}],"metadata":{"creator":"PeakUI","currency":"USD"},"description":"Create a downloadable project budget workbook"}
</openclaw_tool>
```

Required fields:

- `title`: Workbook title.
- `sheets`: At least one sheet with rows.

Common optional fields:

- `filename`: Download filename. `.xlsx` is added when omitted.
- `template`: One of `workbook`, `report`, `invoice`, `budget`, `timesheet`, `ledger`, `inventory`, `schedule`, or `tracker`.
- `metadata`: Optional `creator`, `subject`, `company`, and `currency`.
- `sheet.columns`: Column headers and types.
- `sheet.rows`: Row records or arrays.
- `sheet.tables`: Additional tables on the same sheet.
- `table.totals`: Formula rows such as `sum`, `average`, `count`, `min`, or `max`.

## Canvas Behavior

Generated workbooks are stored as binary XLSX Canvas artifacts with a paired JSON source artifact in the same bundle. Canvas previews treat workbooks as downloadable files, while the source artifact preserves the structured workbook request for review, regeneration, or future editing workflows.
