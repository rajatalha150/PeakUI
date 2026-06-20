# Fetch and Summarize Workflow

PeakUI's `fetch_summarize` tool fetches a public web page and returns a concise, sourced summary.

## When to use it

- The user pastes or mentions a URL and asks what it says.
- You want a quick summary without invoking the full browser tool.
- The page is public and does not need interaction, forms, or JavaScript navigation.

## Tool shape

```json
{
  "name": "fetch_summarize",
  "url": "https://example.com/news-article",
  "description": "Summarize the article"
}
```

## Output

- `title`: The page title when available.
- `bullets`: A short list of key takeaways.
- `quote`: A representative direct quote or excerpt from the page.
- Source chips link back to the original URL.

## Safety notes

- Only public HTTP/HTTPS URLs are fetched.
- The same SSRF guardrails and content sanitization used by the browser stack apply.
- The tool does not execute browser interactions; use `browser` or `unified_browser` for dynamic pages.
