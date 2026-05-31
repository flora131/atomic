---
topic: Claude Design by Anthropic Labs — Comprehensive Product Analysis
researched_at: 2026-04-17
primary_source: https://www.anthropic.com/news/claude-design-anthropic-labs
raw_research: research/web/2026-04-17-claude-design-anthropic-labs.md
purpose: Open-source replica reference — full workflow phases, capabilities, and architecture
---

# Claude Design by Anthropic Labs — Comprehensive Product Analysis

## Summary

Claude Design is an AI-powered visual design product launched by Anthropic Labs on April 17, 2026. It enables users to create polished designs, interactive prototypes, slide decks, one-pagers, marketing collateral, and "frontier design" experiences (code-powered prototypes with voice, video, shaders, 3D, and AI) through conversational prompts and fine-grained editing controls. It is powered by Claude Opus 4.7 (Anthropic's most capable vision model at launch) and available in research preview to Pro, Max, Team, and Enterprise subscribers at claude.ai/design.

The product follows a closed-loop design-to-development pipeline:
**Onboarding (design system) → Import/Prompt → Generate → Refine → Collaborate → Export/Handoff**

---

## Target Users

- **Experienced designers**: Get room to explore more directions than time normally allows
- **Founders / entrepreneurs**: Go from rough idea to shareable prototype without design background
- **Product managers**: Sketch feature flows, wireframe, and hand off to Claude Code
- **Marketers**: Create landing pages, social assets, campaign visuals
- **Account executives**: Build on-brand pitch decks in minutes
- **Anyone**: Build "frontier design" code-powered prototypes with multimedia capabilities

---

## Workflow Phases — Official Breakdown

The official Anthropic announcement describes the workflow as a "natural creative flow" with six named steps. These are the actual phases (not the four-phase research/planning/implementation/validation model the user initially hypothesized):

---

### Phase 1: Design System Onboarding — "Your brand, built in"

**What happens:**
During initial onboarding, Claude reads the team's codebase and design files and automatically constructs a design system encoding:
- Color palette
- Typography choices
- Component library

**Key behaviors:**
- The system is built once, then automatically applied to every subsequent project
- Teams can maintain multiple design systems (e.g., one per product line)
- The system can be refined iteratively after the initial build
- Claude stores the design-system *representation*, not the raw source files themselves (privacy-preserving)
- Source code files are not uploaded to Anthropic's servers
- GitHub integration planned "coming weeks"

**User interaction (HIL points):**
- Claude proposes colors, fonts, and design elements
- User gets to approve each aspect or request changes
- User can revisit and modify the design system after seeing final output
- Per The New Stack's first-person account: "It'll choose colors and fonts, and create the design elements for you, but you get to approve those or ask for changes."

**Tools/capabilities used:**
- Codebase reader (reads local code without uploading)
- Design file parser (DOCX, PPTX, XLSX, and design tool files)
- Claude Opus 4.7 vision model

---

### Phase 2: Import — "Import from anywhere"

**What happens:**
Users initiate a design project through multiple input modalities:

| Input Method | Description |
|---|---|
| Text prompt | Natural language description of what to create |
| Image upload | Upload screenshots, mockups, visual references |
| Document upload | DOCX, PPTX, XLSX files as content source |
| Codebase reference | Point Claude at the team's codebase |
| Web capture tool | Grab elements directly from a live website URL |

**The web capture tool** is particularly notable: it scrapes visual elements from live websites so that prototypes match the look of the real product, rather than creating something generic.

**User interaction (HIL points):**
- User chooses which input method(s) to use
- Can combine inputs (e.g., text prompt + screenshot reference)
- No approval required; Claude proceeds directly to generation

**Tools/capabilities used:**
- Claude Opus 4.7 (text + multimodal vision — images up to 2,576px long edge / ~3.75 megapixels)
- Web scraping / web capture capability
- Document parsing (DOCX, PPTX, XLSX)

---

### Phase 3: Generation — First Version Creation

**What happens:**
Claude generates the first version of the requested artifact based on:
- The input provided in Phase 2
- The team's design system (from Phase 1, if available)
- The conversation context

Output types:
- Interactive prototypes (clickable, user-testable without code review or PRs)
- Product wireframes and mockups
- Pitch decks and presentations
- Marketing collateral (landing pages, social assets, campaign visuals)
- Frontier design experiences (voice, video, shaders, 3D, built-in AI)

**Token usage note:**
Claude Design is "hungry for tokens." The New Stack reported using 50%+ of weekly allotment after: building a design system + news website prototype + a few tweaks + one explainer video. Users can choose between polished mockups or wireframes; wireframes use fewer tokens.

**User interaction (HIL points):**
- User receives the first generated version
- No approval required before generation
- The output is the starting point for refinement

**Tools/capabilities used:**
- Claude Opus 4.7 (generation engine)
- Design system context (from Phase 1)
- Code generation for "frontier design" features

---

### Phase 4: Refinement — "Refine with fine-grained controls"

**What happens:**
This is the iterative feedback loop. Users can refine the generated design through multiple mechanisms simultaneously:

| Mechanism | Description |
|---|---|
| Chat conversation | Natural language requests in the conversation thread |
| Inline comments | Click on a specific element to comment on it directly |
| Direct text editing | Edit text content inline without prompting |
| Adjustment knobs/sliders | Claude-generated UI controls to tweak spacing, color, layout in real time |

**The adjustment sliders are a distinctive feature:** Claude itself generates the specific sliders that make sense for each design (e.g., "padding", "primary color hue", "font size scale"). These let users tweak parameters live without prompting Claude. Users can then ask Claude to apply their slider changes across the full design.

**Drawing on designs** is also supported — users can literally draw/annotate on the design canvas.

**Example from Brilliant:** Most complex pages required 20+ prompts to recreate in other tools but only 2 prompts in Claude Design.

**Example from Datadog:** Week-long cycle of briefs, mockups, and review rounds now happens in a single conversation.

**User interaction (HIL points):**
- All refinement is user-initiated and iterative
- Multiple rounds of feedback supported
- User explicitly requests changes (conversation) or makes changes directly (editing, sliders)
- Claude can apply changes globally ("apply this across the full design")

**Tools/capabilities used:**
- Claude Opus 4.7 (refinement engine)
- Custom-generated adjustment UI (sliders/knobs) — unique per design
- Canvas drawing/annotation
- Real-time layout updates

---

### Phase 5: Collaboration — "Collaborate"

**What happens:**
Designs have organization-scoped sharing controls:

| Share Mode | Description |
|---|---|
| Private | Only the creator can see and edit |
| View-only link | Anyone in the organization with the link can view |
| Edit access | Colleagues can modify the design and chat with Claude in a group conversation |

**Group conversation feature:** Multiple team members can collaborate with Claude simultaneously in a shared design session.

**User interaction (HIL points):**
- Creator chooses share mode
- Collaborators can participate in the Claude conversation
- All team members interact with the same design artifact

**Tools/capabilities used:**
- Organization-scoped access control
- Shared Claude conversation context (multi-user)

---

### Phase 6: Export and Handoff — "Export anywhere" + "Handoff to Claude Code"

**What happens:**
The design can be exported in multiple formats or handed off directly to Claude Code:

**Export formats:**
| Format | Description |
|---|---|
| Internal URL | Organization-scoped link for sharing |
| Folder (save) | Save as a folder structure |
| Canva export | Send to Canva as fully editable, collaborative design |
| PDF | Export as PDF |
| PPTX | Export as PowerPoint (for presentations) |
| Standalone HTML | Export as standalone HTML file |

**Claude Code Handoff (key differentiator):**
When a design is ready to build, Claude packages everything into a "handoff bundle" that includes:
- The design itself
- Design intent (the reasoning behind design decisions)
- Design tokens
- Component specifications

This bundle can be passed to Claude Code with a single instruction. It creates a closed loop: exploration → prototype → production code, all within Anthropic's ecosystem.

The Brilliant team testimonial confirms: "Including design intent in Claude Code handoffs has made the jump from prototype to production seamless."

**Future integrations:** Anthropic committed to making it easier to connect Claude Design to more tools via MCPs "in the coming weeks."

**User interaction (HIL points):**
- User chooses export format or handoff destination
- Canva export makes design "fully editable and collaborative" in Canva
- Claude Code handoff is a single instruction

**Tools/capabilities used:**
- Export engine (PDF, PPTX, HTML, folder)
- Canva integration (partnership)
- Claude Code handoff packaging
- GitHub integration (planned)

---

## The Design Plugin (Cowork/Claude Code Integration)

Source: https://github.com/anthropics/knowledge-work-plugins/tree/main/design

Claude Design also ships as a plugin (`knowledge-work-plugins/design`) for Claude Cowork and Claude Code. This exposes a distinct set of workflow tools:

### Plugin Commands

| Command | Trigger Phrases | Description |
|---|---|---|
| `/critique` | "review this design", "critique this mockup" | Structured design feedback on usability, hierarchy, accessibility, consistency |
| `/design-system` | "audit design system" | Audit, document, or extend component libraries and tokens |
| `/handoff` | "generate handoff specs" | Developer handoff with measurements, tokens, states, interactions, edge cases |
| `/ux-copy` | "write UX copy", "review microcopy" | Write/review microcopy, error messages, empty states, onboarding flows |
| `/accessibility` | "audit accessibility", "check a11y" | WCAG 2.1 AA compliance audit with specific severity ratings |
| `/research-synthesis` | "synthesize research" | Condense interviews, surveys, usability tests into actionable insights |

### Critique Framework Details

The `/critique` command evaluates:
1. **First Impression (2 seconds)**: Eye movement, emotional reaction, clarity of purpose
2. **Usability**: Goal accomplishment, navigation, interactive elements, unnecessary steps
3. **Visual Hierarchy**: Reading order, emphasis, whitespace, typography hierarchy
4. **Consistency**: Design system adherence, spacing, colors, behavior
5. **Accessibility**: Color contrast, touch targets, readability, alt text

Output format: Markdown tables with severity ratings (Critical/Moderate/Minor) and recommendations.

### Accessibility Audit (WCAG 2.1 AA)

Checks against:
- Perceivable: alt text (1.1.1), semantic structure (1.3.1), contrast 4.5:1 (1.4.3), non-text contrast 3:1 (1.4.11)
- Operable: keyboard access (2.1.1), focus order (2.4.3), visible focus (2.4.7), touch targets 44x44px (2.5.5)
- Understandable: predictable focus (3.2.1), error identification (3.3.1), input labels (3.3.2)
- Robust: name/role/value (4.1.2)

Testing approach: automated scan (~30% of issues) + keyboard navigation + screen reader + color contrast + 200% zoom test.

### Developer Handoff Spec Format

Includes:
- Visual Specifications: exact measurements (px), design token references, responsive breakpoints, component variants/states
- Interaction Specifications: click/tap, hover states, transitions (duration + easing), gesture support
- Content Specifications: character limits, truncation, empty/loading/error states
- Edge Cases: min/max content, international text, slow connections, missing data
- Accessibility: focus order, ARIA labels, keyboard interactions, screen reader announcements

Principle: always reference design tokens (`spacing-md`) not raw values (`16px`).

### MCP Connectors

The plugin uses MCP (Model Context Protocol) for tool integrations:

| Category | Placeholder | Default Servers | Alternatives |
|---|---|---|---|
| Design tool | `~~design tool` | Figma | Sketch, Adobe XD, Framer |
| Chat | `~~chat` | Slack | Microsoft Teams |
| Knowledge base | `~~knowledge base` | Notion | Confluence, Guru, Coda |
| Project tracker | `~~project tracker` | Linear, Asana, Atlassian | Shortcut, ClickUp |
| User feedback | `~~user feedback` | Intercom | Productboard, Canny, UserVoice, Dovetail |
| Product analytics | `~~product analytics` | (none default) | Amplitude, Mixpanel, Heap, FullStory |

### Standalone vs. Supercharged

Every command works standalone (screenshots, descriptions) but gets enhanced with MCP:
- Design critique standalone: paste screenshot or describe | supercharged: Figma MCP pulls design directly
- Handoff standalone: describe or screenshot | supercharged: Figma MCP provides exact measurements + tokens
- Accessibility standalone: describe or screenshot | supercharged: Figma MCP + real usage analytics
- Research synthesis standalone: paste transcripts | supercharged: user feedback tools pull raw data

---

## Architecture and Technical Details

### Model: Claude Opus 4.7

- Most capable generally available vision model from Anthropic (as of April 2026)
- Accepts images up to 2,576px on the long edge (~3.75 megapixels, 3x prior Claude models)
- 64.3% on SWE-bench Pro
- 13% improvement over Opus 4.6 on Anthropic's internal 93-task coding benchmark
- 98.5% on XBOW visual-acuity benchmark (vs 54.5% for Opus 4.6)
- API pricing: $5/M input tokens, $25/M output tokens

### Data Privacy

- Design system representation stored, not source files
- Local code references are not uploaded to Anthropic's servers
- Anthropic explicitly does not train on Claude Design data
- Enterprise: off by default, admin-controlled

### Frontier Design Capabilities

The "frontier design" category is explicitly listed as:
> Code-powered prototypes with voice, video, shaders, 3D and built-in AI

This goes beyond static visuals into interactive, multimedia experiences generated without manual coding.

### Design System Architecture

Design systems in Claude Design:
- Built by reading codebase + existing design files at onboarding
- Encode: colors, typography, component library
- Applied automatically to every new project
- Multiple design systems per team supported
- Refine-able over time
- Stored as a representation (not the raw files) for privacy

### Handoff Bundle Structure

When handing off to Claude Code, the bundle includes:
- The design artifacts
- Design intent (reasoning, not just visuals)
- Design tokens
- Component specifications
- Interaction notes

This is distinct from a simple export — it's an annotated specification that Claude Code can act on directly.

---

## Competitive Context

| Tool | Relationship to Claude Design |
|---|---|
| Figma | Primary incumbent; Anthropic CPO resigned from Figma board days before launch; Figma stock fell 5% |
| Canva | Partner (export integration); Anthropic says "complement not replace" |
| Adobe | Secondary incumbent targeted by design democratization angle |
| OpenAI Codex | Similar visual asset generation; Claude Design goes further with sliders, drawing, MCP |

Claude Design's competitive differentiators:
1. Natural language refinement with generated adjustment sliders (not just chat)
2. Design intent preserved in Claude Code handoff bundles
3. Design system built from actual codebase (not generic templates)
4. Web capture tool (pull from live sites)
5. Closed-loop ecosystem with Claude Code
6. Frontier design (voice, video, 3D, shaders) without coding

---

## Anthropic Labs Context

- Claude Design is an Anthropic Labs product (not core Claude product)
- Labs team: Mike Krieger (co-founder of Instagram, former Anthropic CPO) + Ben Mann (engineering lead)
- Krieger reports to President Daniela Amodei
- Labs track record: Claude Code ($1B product in 6 months), MCP (100M monthly downloads), Cowork (built in 1.5 weeks), Skills, Claude in Chrome
- Labs operates as an R&D incubator freed from traditional product constraints

---

## Workflow Summary Diagram

```
[Team Codebase / Design Files]
         |
         v
┌─────────────────────────────┐
│  PHASE 1: ONBOARDING        │
│  Design System Construction │  ← Claude reads codebase + design files
│  Colors / Typography /      │  ← User approves or requests changes
│  Components                 │
└─────────────┬───────────────┘
              |
              v
┌─────────────────────────────┐
│  PHASE 2: IMPORT            │
│  Input Modalities:          │
│  - Text prompt              │
│  - Image/document upload    │
│  - Codebase reference       │
│  - Web capture tool         │
└─────────────┬───────────────┘
              |
              v
┌─────────────────────────────┐
│  PHASE 3: GENERATION        │
│  First Version Created:     │
│  - Prototypes               │
│  - Wireframes/Mockups       │
│  - Pitch Decks              │
│  - Marketing Collateral     │
│  - Frontier Design          │
└─────────────┬───────────────┘
              |
              v
┌─────────────────────────────┐
│  PHASE 4: REFINEMENT        │ ← Iterative loop (multiple rounds)
│  Mechanisms:                │
│  - Chat conversation        │
│  - Inline comments          │
│  - Direct text editing      │
│  - Claude-generated sliders │
│  - Drawing/annotation       │
│  - Global change propagation│
└─────────────┬───────────────┘
              |
              v
┌─────────────────────────────┐
│  PHASE 5: COLLABORATION     │
│  - Private / View / Edit    │
│  - Group conversation with  │
│    Claude (multi-user)      │
└─────────────┬───────────────┘
              |
              v
┌─────────────────────────────┐
│  PHASE 6: EXPORT / HANDOFF  │
│  Export:                    │
│  - Internal URL             │
│  - Canva (editable)         │
│  - PDF                      │
│  - PPTX                     │
│  - Standalone HTML          │
│  - Folder/save              │
│                             │
│  Handoff Bundle → Claude Code│ ← Design intent preserved
└─────────────────────────────┘
```

---

## Open-Source Replica Implementation Notes

For building an open-source replica of the Claude Design workflow:

### Core Workflow Engine Requirements

1. **Design System Builder**
   - Read codebase files and extract design tokens (colors, fonts, spacing)
   - Read existing design files (DOCX, PPTX, visual assets)
   - Build a structured design system representation
   - Human-in-the-loop approval at each major decision (color palette, typography, components)
   - Support multiple design systems per workspace

2. **Input Handler**
   - Text prompt ingestion
   - File upload handling (images, DOCX, PPTX, XLSX)
   - Codebase reader (local, no-upload)
   - Web capture tool (headless browser scraping of live URLs)

3. **Generation Engine**
   - Vision model integration (Claude Opus 4.7 or equivalent)
   - Context injection (design system + input + conversation history)
   - Output types: HTML/CSS prototypes, presentation decks, marketing assets
   - Frontier design: voice/video/3D/shader integration

4. **Refinement Interface**
   - Chat thread for natural language requests
   - Inline comment system on design elements
   - Direct text editing
   - Dynamic slider/knob generation (Claude generates the appropriate controls per design)
   - Global change propagation ("apply across full design")
   - Drawing/annotation layer

5. **Collaboration Layer**
   - Organization-scoped access control (private/view/edit)
   - Shared conversation context (multi-user Claude session)

6. **Export Engine**
   - HTML export
   - PDF generation
   - PPTX generation
   - URL sharing (internal)
   - Canva API integration
   - Claude Code handoff bundle packaging (design + intent + tokens + specs)

7. **Plugin Commands (for Claude Code / Cowork integration)**
   - `/critique` — structured design feedback
   - `/design-system` — component library audit
   - `/handoff` — developer specs
   - `/ux-copy` — microcopy writing/review
   - `/accessibility` — WCAG 2.1 AA audit
   - `/research-synthesis` — user research condensation

8. **MCP Connectors**
   - Figma MCP (design inspection, component access, token retrieval)
   - Slack MCP (sharing, notifications)
   - Notion MCP (brand guidelines, design principles)
   - Linear/Asana/Jira MCP (link designs to tickets)
   - Analytics MCPs (Amplitude, Mixpanel)

---

## All Source Links

- [Official Anthropic Announcement](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [TechCrunch](https://techcrunch.com/2026/04/17/anthropic-launches-claude-design-a-new-product-for-creating-quick-visuals/)
- [VentureBeat (most detailed)](https://venturebeat.com/technology/anthropic-just-launched-claude-design-an-ai-tool-that-turns-prompts-into-prototypes-and-challenges-figma)
- [The New Stack (first-person usage)](https://thenewstack.io/anthropic-claude-design-launch/)
- [GitHub Plugin Repository](https://github.com/anthropics/knowledge-work-plugins/tree/main/design)
- [Claude Design Plugin Page](https://claude.com/plugins/design)
- [Hacker News Discussion (459 pts, 288 comments)](https://news.ycombinator.com/item?id=47806725)
- [9to5Mac](https://9to5mac.com/2026/04/17/anthropic-launches-claude-design-for-mac-following-opus-4-7-model-upgrade/)
- [StartupHub.ai](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/anthropic-unveils-claude-design)
- [Yahoo Tech](https://tech.yahoo.com/ai/claude/articles/anthropic-debuts-claude-design-building-150000621.html)
- [Canva Newsroom](https://www.canva.com/newsroom/news/canva-claude-design/)
- [Introducing Anthropic Labs](https://www.anthropic.com/news/introducing-anthropic-labs)
- [Claude X/Twitter announcement](https://x.com/claudeai/status/2045156267690213649)
- [Claude Design direct access](https://claude.ai/design)
