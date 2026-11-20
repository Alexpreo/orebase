# OreBase UI redesign — design source

Exported from the Claude Design canvas "OreBase UI Redesign".

## What's in this folder
- `html/*.html` — **start here.** Standalone, fully rendered pages. Open any of them in a browser;
  they link to each other. Static snapshots: the Screener toggles, Project tabs and Motion replay
  don't respond, but every visual state, color and animation is there.
- `html/previews/*.png` — full-page screenshots at 1440 px wide, for side-by-side comparison.
- `*.dc.html` — the editable design source (template format explained below). Use these for
  logic and states: the Screener filters and the Project tabs are defined in their script blocks.

The .dc.html files are design references, not app code. They use the canvas runtime's template syntax:
- `<x-dc>` wraps the markup; `<helmet>` holds fonts, keyframes and hover rules.
- `{{name}}` is a value from `renderVals()` in the `<script type="text/x-dc">` block at the bottom.
- `<sc-for list="{{items}}" as="item">` = map over a list; `<sc-if value="{{x}}">` = conditional.
- `<dc-import name="Sidebar" active="home">` = the shared Sidebar.dc.html component with a prop.

Read the inline styles for exact colors, spacing, radii and type; read `<helmet><style>` for animations.
Project names, resource figures, economics and spend values are illustrative placeholders —
bind every number to real queries. Filing rows (companies, dates, sizes) are real SEDAR+ data.

| File | Route |
|---|---|
| Main.dc.html | `/` (Home briefing — new) |
| Chat.dc.html | `/chat`, `/chat/[id]` |
| Screener.dc.html | `/screener` |
| Project.dc.html | `/projects/[id]` |
| Company.dc.html | `/companies/[id]` (and list style for `/companies`) |
| Watchlist.dc.html | `/watchlist` |
| Research.dc.html | `/research` |
| Documents.dc.html | `/documents` |
| DocumentViewer.dc.html | `/documents/[id]` |
| Admin.dc.html | `/admin` |
| Review.dc.html | `/admin/review` |
| SignIn.dc.html | `/sign-in`, `/sign-up` |
| Sidebar.dc.html | `components/app-sidebar.tsx` |
| Motion.dc.html | motion tokens and rules (no route) |
