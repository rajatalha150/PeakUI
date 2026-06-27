# Mermaid Document Workflow

PeakUI's `mermaid_document` tool renders a Mermaid diagram to a downloadable `.svg` (or `.png`) Canvas artifact. Use it whenever the user asks for a flowchart, sequence diagram, ER diagram, class diagram, state diagram, or any other Mermaid-rendered visualization.

## When to use it

- The user asks for a flowchart, sequence diagram, ER diagram, class diagram, state diagram, or "Mermaid" diagram.
- You have a graph or process you can express in Mermaid syntax.
- You want a real diagram that renders inline in Canvas and is downloadable as SVG (or PNG).

Do not write Mermaid source to a `.md` file when this tool is available — the rendered SVG is a tracked Canvas artifact that can be re-edited and re-rendered.

## Tool shape

```xml
<openclaw_tool name="mermaid_document">
{
  "title": "User Login Flow",
  "filename": "user-login-flow.svg",
  "diagram": "graph TD; A[User] --> B[Login Form]; B --> C{Valid?}; C -- Yes --> D[Dashboard]; C -- No --> B",
  "format": "svg",
  "theme": "default",
  "backgroundColor": "FFFFFF",
  "description": "Render a Mermaid diagram of the user login flow as SVG"
}
</openclaw_tool>
```

## Fields

- `title` (required): Display title for the artifact. Defaults to `Diagram` when omitted.
- `diagram` (required): Mermaid source. The renderer passes this through to `@mermaid-js/mermaid-cli`.
- `format` (optional): `svg` (default) or `png`.
- `theme` (optional): `default`, `dark`, `forest`, or `neutral`.
- `backgroundColor` (optional): Background color hex (`RRGGBB` or `#RRGGBB`). Defaults to white.
- `filename` (optional): Download filename. `.svg` or `.png` is appended based on `format` when omitted.
- `description` (optional): Human-readable approval text.

## How It Renders

1. The renderer writes the `.mmd` source to a temp directory.
2. It shells out to `@mermaid-js/mermaid-cli` (mmdc) with the system Chromium binary that ships in the container image (`/usr/bin/chromium-browser` via a Puppeteer config), so Puppeteer does not try to download its own Chromium at runtime.
3. mmdc produces an SVG (or PNG) of the rendered diagram.
4. The bytes are stored as a Canvas artifact with `kind: 'diagram-mermaid'` and `extension: 'svg`/`png` matched to the actual format.
5. A sibling `kind: 'data'` source artifact (`.mmd`) holds the original Mermaid source so the diagram can be re-rendered by editing the source.

## Output

- A Canvas artifact with `kind: 'diagram-mermaid'`.
- The Canvas modal preview uses the server-side preview endpoint, which returns the `.mmd` source. The modal lazy-loads Mermaid from the CDN and renders the diagram as a live SVG in place.
- Downloads go through `/api/canvas/artifacts/<id>/download` (which decodes base64 correctly) so the SVG opens cleanly in any browser.

## Fallback Behavior

If `mmdc` cannot launch (Chromium missing, network blocked, etc.), the renderer falls back to a labeled placeholder SVG that:

- Shows the diagram title in the title bar.
- Renders the raw `.mmd` source in a bordered panel labeled "Mermaid diagram source" so the user can still see the diagram code.
- Includes a "Re-render" hint in the description.

The placeholder is recognizable but never silently broken — it always renders the source, so the user can copy it into another renderer.

## Safety notes

- The tool only produces a diagram; it never executes shell commands or writes to arbitrary filesystem paths.
- Diagram size is bounded by the request/response size limits enforced by the API.