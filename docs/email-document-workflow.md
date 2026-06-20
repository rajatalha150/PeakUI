# Email Document Workflow

PeakUI's `email_document` tool generates a downloadable `.eml` email draft from a subject, body, and optional metadata.

## When to use it

- The user asks to draft a formal email, outreach message, or reply.
- You want a real `.eml` file the user can open in their mail client and edit/send.
- Attachments are provided as existing Canvas artifact references.

## Tool shape

```json
{
  "name": "email_document",
  "title": "Project Kickoff",
  "filename": "project-kickoff.eml",
  "to": "team@example.com",
  "subject": "Project Kickoff - Next Steps",
  "body": "Hi team,\n\nHere are the next steps for the project...",
  "html": "<p>Hi team,</p><p>Here are the next steps...</p>"
}
```

## Output

- A Canvas artifact with MIME type `message/rfc822` and extension `.eml`.
- The `.eml` file is RFC-5322 compatible and includes a multipart/alternative HTML+plain-text body when both are provided.
- Optional attachments are referenced from existing Canvas artifacts.

## Safety notes

- The tool only generates draft files; it does not send email or connect to SMTP.
- Recipients and subjects are surfaced in the WorkSpaces approval modal.
