# History

Planning documents from before the first line of product code. They are kept as a record of how the architecture and
the Regie (control room) design came about.

**These files are historical, written in German and not maintained.** They were moved here unchanged from the former
`plan` folder (issue #6). They still use the former product name FlowStudio and describe the state of 21–22 October 2026. For the
current design see [`../architecture/implementation-spec.md`](../architecture/implementation-spec.md),
[`../../PRODUCT.md`](../../PRODUCT.md) and [`../../DESIGN.md`](../../DESIGN.md); where they differ, those documents win.

| File | What it is |
|---|---|
| `FlowStudio Architekturplan.html` | Architecture and plan, draft 2 (22 October 2026). Open it in a browser. |
| `regie-entwurf.png`, `regie-studio.png`, `regie-docks.png` | Screenshots of the Regie prototype used as figures in the plan. They must stay next to the HTML file because it refers to them by relative path. |
| `archiv/FlowStudio Architekturplan - Entwurf 1.html` | Draft 1 of the plan (21 October 2026), superseded by draft 2. |

## Design phase (`design/`)

Material of the design phase of the Regie, moved here from the former `.impeccable/` folder (issue #60). German in part,
unmaintained; `DESIGN.md` is the current design.

| File | What it is |
|---|---|
| `design/design.json` | Design tokens of the prototype (German names), the source of the first `DESIGN.md`. |
| `design/decision-payload.json` | The design decision round ("Inspizientenpult") with the options that were weighed. |
| `design/surfaces/` | Briefs of the prototype and of the product page. |
| `design/tools/` | Helpers of that phase: `make-artifact.ps1` (HTML to a Claude artifact), `capture.ps1` (review screenshots with Edge), `mobile-wrap.html`. They expect to live in `tools/` and write to the removed `.impeccable/review`; adjust the paths before use. |

Do not translate or edit these files. Add new design notes under `docs/architecture/` instead.
