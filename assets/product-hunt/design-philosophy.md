# Product Hunt Asset Philosophy: Warm-to-Cool Cartography

Atomic's Product Hunt gallery walks viewers from the chaos of unstructured agent runs to the discipline of orchestrated workflows. The visual journey moves warm to cool: maroon and red signal friction at the start, sapphire and teal carry orchestration through the middle, and a single cream slide breaks the rhythm with light. Mauve appears once per relevant slide as the human-judgment bridge between the two poles.

The form language is Arc Browser marketing, retuned for a developer tool. Saturated liquid-silk gradients form the field, each composed of layered radial gradients deformed by SVG turbulence so the texture feels organic rather than CSS-flat. Film grain sits over every slide at low opacity to kill digital sheen. Compositions are asymmetric and editorial — left-aligned headlines, off-center artifacts, magazine-style number markers — never the centered hero-card pattern that signals AI output.

The Atomic TUI is the campaign's product artifact. Five rendered states (idle, multi-agent running, review gate, done, devcontainer) provide pixel-true HTML/CSS proof of what the tool does. Slides 1, 2, 4, 6 surface the TUI directly; slide 5 reframes the architecture itself as nested terminal panes (cartography, not flowchart). JetBrains Mono carries every TUI surface; Bricolage Grotesque sets the headlines; Geist Sans handles the body.

One word per relevant slide receives the bubble treatment — an inflated, chrome-like display effect built from layered text-shadows and a `mix-blend-mode: overlay` specular highlight. The fill stays solid; gradient text fills are banned. Bubble appears on slide 1 (`reliable`), slide 3 (`After`), and slide 6 (`lower`). It is reserved as a delight moment, never sprayed across the gallery.

Color carries trust the same way the in-product TUI does. Warm pole — maroon, red, peach — signals risk and uncontrolled execution (Before, Host machine). Cool pole — sapphire, sky, blue, teal — signals orchestration and containment (After, Devcontainer boundary, Atomic workflow). Mauve marks the moment of human judgment that bridges the two. The cream slide (Architecture) gives the gallery breathing room and proves Atomic can sit confidently outside its own dark-terminal context.

Banned: gradient text fills, `border-left` accent stripes wider than 1px, soft purple radial glows, repeating identical card grids, generic pill flowcharts, pure black or pure white. Every rejected pattern is a 2024-2025 AI design tell.

## Pipeline

Slides are authored as HTML in `slides/0X-*.html`, sharing tokens, components, fonts, and TUI chrome from `_shared/`. Playwright headless Chromium rasterizes each slide at 1270×760 @2x to PNG. Single command:

```sh
bun run assets/product-hunt/generate-product-hunt-assets.ts
```

## Slide map

| # | Slide | Theme | Bubble word | Backdrop |
|---|---|---|---|---|
| 1 | Hero | Warm | `reliable` | `liquid-silk--warm` (saturated) |
| 2 | Workflow-as-code | Dark + cool edge | — | Mocha + cool silk right edge |
| 3 | Before / After | Diptych | `After` | `liquid-silk--warm` ↔ `liquid-silk--cool` |
| 4 | Use cases | Dark + cool corner | — | Mocha + cool silk top-right |
| 5 | Architecture | Light cream | — | `liquid-silk--cream` (cool right bleed) |
| 6 | Safety / devcontainer | Cool | `lower` | `liquid-silk--cool` (saturated) |
