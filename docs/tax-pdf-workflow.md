# Tax PDF Workflow

PeakUI can create downloadable tax PDF artifacts from Knowledge Base documents through the WorkSpaces `tax_return` tool.

## What It Does

- Loads ready Knowledge Base documents from the enabled folder or the folder named in the tool request.
- Extracts obvious W-2, 1099, SSA-1099, taxpayer name, SSN, address, and income/withholding fields into a strict structured draft.
- Carries source citations for extracted fields and reports missing/uncertain fields.
- Generates a review PDF packet and stores it as a Canvas artifact.
- Optionally fills an uploaded fillable AcroForm PDF template and returns a filled PDF artifact.

## User Flow

1. Upload a folder of tax documents into Knowledge Base.
2. Wait until the documents show as indexed/ready.
3. Enable RAG for that folder in WorkSpaces.
4. Ask the AI to prepare a tax return PDF from the folder.
5. Approve the Tax PDF Generation Approval prompt.
6. Download the generated PDF card from the chat response.

For a fillable template, upload the PDF after this feature is deployed so PeakUI retains the original PDF bytes. Then ask the AI to fill that template. The current MVP fills AcroForm fields by best-effort field-name matching. XFA-only forms are detected but are not reliably fillable.

## Tool Contract

```xml
<openclaw_tool name="tax_return">
{"action":"generate_review_pdf","folder":"2025/taxes","taxYear":"2025","description":"Create a downloadable tax review PDF from the enabled Knowledge Base folder"}
</openclaw_tool>
```

Supported actions:

- `generate_review_pdf`: Creates a review packet from extracted tax data.
- `fill_pdf_form`: Fills an uploaded template PDF. Requires `templateDocumentId`.

Optional fields:

- `folder`: Knowledge Base folder path. If omitted, WorkSpaces uses the currently enabled RAG folder when available.
- `taxYear`: Tax year. If omitted, the extractor attempts to infer it.
- `templateDocumentId`: Knowledge Base document id for a fillable PDF template.
- `flatten`: When `true`, flattens the filled AcroForm output.

## Safety And Limits

- The generated packet is a review draft, not an official filed return.
- PeakUI does not e-file, sign, or submit returns.
- The extractor is deterministic and conservative; users must verify all values before filing.
- Original bytes are retained only for uploaded PDFs so fillable templates can be processed later.
- The initial extraction focuses on common W-2, 1099-NEC, 1099-INT, 1099-DIV, SSA-1099, SSN, name, address, and federal withholding fields.
