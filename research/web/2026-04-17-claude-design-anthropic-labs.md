---
source_url: https://www.anthropic.com/news/claude-design-anthropic-labs
fetched_at: 2026-04-17
fetch_method: html-parse + playwright-cli + web-search
topic: Claude Design by Anthropic Labs — official announcement, coverage, and plugin details
additional_sources:
  - https://techcrunch.com/2026/04/17/anthropic-launches-claude-design-a-new-product-for-creating-quick-visuals/
  - https://venturebeat.com/technology/anthropic-just-launched-claude-design-an-ai-tool-that-turns-prompts-into-prototypes-and-challenges-figma
  - https://thenewstack.io/anthropic-claude-design-launch/
  - https://github.com/anthropics/knowledge-work-plugins/tree/main/design
  - https://claude.com/plugins/design
  - https://news.ycombinator.com/item?id=47806725
  - https://www.startuphub.ai/ai-news/artificial-intelligence/2026/anthropic-unveils-claude-design
  - https://www.canva.com/newsroom/news/canva-claude-design/
  - https://www.anthropic.com/news/introducing-anthropic-labs
---

# Claude Design by Anthropic Labs — Primary Source Collection

## Official Anthropic Announcement (Full Extracted Text)

Source: https://www.anthropic.com/news/claude-design-anthropic-labs  
Published: April 17, 2026

> Today, we're launching Claude Design, a new Anthropic Labs product that lets you collaborate with Claude to create polished visual work like designs, prototypes, slides, one-pagers, and more. Claude Design is powered by our most capable vision model, Claude Opus 4.7, and is available in research preview for Claude Pro, Max, Team, and Enterprise subscribers. We're rolling out to users gradually throughout the day.

### Design with Claude

> Even experienced designers have to ration exploration—there's rarely time to prototype a dozen directions, so you limit yourself to a few. And for founders, product managers, and marketers with an idea but not a design background, creating and sharing those ideas can be daunting. Claude Design gives designers room to explore widely and everyone else a way to produce visual work. Describe what you need and Claude builds a first version. From there, you refine through conversation, inline comments, direct edits, or custom sliders (made by Claude) until it's right. When given access, Claude can also apply your team's design system to every project automatically, so the output is consistent with the rest of your company's designs.

### Use Cases (from official announcement)

Teams have been using Claude Design for:

- **Realistic prototypes**: Designers can turn static mockups into easily-shareable interactive prototypes to gather feedback and user-test, without code review or PRs.
- **Product wireframes and mockups**: Product Managers can sketch out feature flows and hand them off to Claude Code for implementation, or share them with designers to refine further.
- **Design explorations**: Designers can quickly create a wide range of directions to explore.
- **Pitch decks and presentations**: Founders and Account Executives can go from a rough outline to a complete, on-brand deck in minutes, and then export as a PPTX or send to Canva.
- **Marketing collateral**: Marketers can create landing pages, social media assets, and campaign visuals, then loop in designers to polish.
- **Frontier design**: Anyone can build code-powered prototypes with voice, video, shaders, 3D and built-in AI.

### How It Works (Official Workflow Description)

Claude Design follows a natural creative flow:

**1. Your brand, built in.**
> During onboarding, Claude builds a design system for your team by reading your codebase and design files. Every project after that uses your colors, typography, and components automatically. You can refine the system over time, and teams can maintain more than one.

**2. Import from anywhere.**
> Start from a text prompt, upload images and documents (DOCX, PPTX, XLSX), or point Claude at your codebase. You can also use the web capture tool to grab elements directly from your website so prototypes look like the real product.

**3. Refine with fine-grained controls.**
> Comment inline on specific elements, edit text directly, or use adjustment knobs to tweak spacing, color, and layout live. Then ask Claude to apply your changes across the full design.

**4. Collaborate.**
> Designs have organization-scoped sharing. You can keep a document private, share it so anyone in your organization with the link can view it, or grant edit access so colleagues can modify the design and chat with Claude together in a group conversation.

**5. Export anywhere.**
> Share designs as an internal URL within your organization, save as a folder, or export to Canva, PDF, PPTX, or standalone HTML files.

**6. Handoff to Claude Code.**
> When a design is ready to build, Claude packages everything into a handoff bundle that you can pass to Claude Code with a single instruction.

> Over the coming weeks, we'll make it easier to build integrations with Claude Design, so you can connect it to more of the tools your team already uses.

### Partner Testimonials (Official)

**Melanie Perkins, Co-Founder and CEO, Canva:**
> We've loved collaborating with Anthropic over the past couple of years and share a deep focus on making complex things simple. At Canva, our mission has always been to empower the world to design, and that means bringing Canva to wherever ideas begin. We're excited to build on our collaboration with Claude, making it seamless for people to bring ideas and drafts from Claude Design into Canva, where they instantly become fully editable and collaborative designs ready to refine, share, and publish.

**Olivia Xu, Senior Product Designer, Brilliant:**
> Brilliant's intricate interactivity and animations are historically painful to prototype, but Claude Design's ability to turn static designs into interactive prototypes has been a step change for us. Our most complex pages, which took 20+ prompts to recreate in other tools, only required 2 prompts in Claude Design. Including design intent in Claude Code handoffs has made the jump from prototype to production seamless.

**Aneesh Kethini, Product Manager, Datadog:**
> Claude Design has made prototyping dramatically faster for our team, enabling live design during conversations. We've gone from a rough idea to a working prototype before anyone leaves the room, and the output stays true to our brand and design guidelines. What used to take a week of back-and-forth between briefs, mockups, and review rounds now happens in a single conversation.

### Access & Pricing

- Available for Claude Pro, Max, Team, and Enterprise subscribers
- Included with plan subscription limits; extra usage available as pay-as-you-go
- For Enterprise: off by default, admins enable in Organization settings
- Entry point: claude.ai/design

---

## TechCrunch Coverage

Source: https://techcrunch.com/2026/04/17/anthropic-launches-claude-design-a-new-product-for-creating-quick-visuals/  
Author: Aisha Malik, Published: April 17, 2026

Key excerpts:
- Claude Design is "intended to help people like founders and product managers without a design background share their ideas more easily."
- "While Claude Design may initially seem like it's looking to compete with popular design app Canva... Anthropic told TechCrunch that it's intended to complement it rather than replace it."
- "Claude Design can also apply a team's design system to every project it creates so that the results are consistent with the company's overall visual style. Anthropic says Claude Design is able to do this by reading a company's codebase and design files."
- The launch follows Claude Cowork (January 2026) and agentic plug-ins for Cowork.
- Anthropic is in discussions for a potential IPO at ~$800B valuation.

---

## VentureBeat Coverage (Most Detailed Technical/Business Analysis)

Source: https://venturebeat.com/technology/anthropic-just-launched-claude-design-an-ai-tool-that-turns-prompts-into-prototypes-and-challenges-figma  
Author: Michael Nuñez, Published: April 17, 2026

Key technical details:

**Workflow:**
> The product follows a workflow that Anthropic has designed to feel like a natural creative conversation. Users describe what they need, and Claude generates a first version. From there, refinement happens through a combination of channels: chat-based conversation, inline comments on specific elements, direct text editing, and custom adjustment sliders that Claude itself generates to let users tweak spacing, color, and layout in real time.

**Design System Onboarding:**
> During onboarding, Claude reads a team's codebase and design files and builds a design system — colors, typography, and components — that it automatically applies to every subsequent project.

**Web Capture Tool:**
> A web capture tool grabs elements directly from a live website so prototypes look like the real product.

**Handoff Mechanism:**
> What distinguishes Claude Design from the wave of AI design experiments that have proliferated in the past year is the handoff mechanism. When a design is ready to build, Claude packages everything into a handoff bundle that can be passed to Claude Code with a single instruction. That creates a closed loop — exploration to prototype to production code — all within Anthropic's ecosystem.

**Export Options:**
> Users can also share designs as an internal URL within their organization, save as a folder, or export to Canva, PDF, PPTX, or standalone HTML files.

**Data Privacy:**
> The system stores the design-system representation it generates — not the source files themselves. When users link a local copy of their code, it is not uploaded to or stored on Anthropic's servers. Anthropic states unequivocally that it does not train on this data.

**Model (Claude Opus 4.7) details:**
- Reached 64.3% on SWE-bench Pro
- 13% resolution improvement over Opus 4.6 on internal 93-task coding benchmark
- Vision: can accept images up to 2,576 pixels on the long edge (~3.75 megapixels, 3x prior models)
- XBOW reported 98.5% on visual-acuity benchmark vs 54.5% for Opus 4.6

**Business Context:**
- Anthropic hit ~$20B ARR in early March 2026, ~$30B by early April 2026
- In early IPO talks with Goldman Sachs, JPMorgan, Morgan Stanley (possible Oct 2026)
- Mike Krieger (Instagram co-founder, former Anthropic CPO) resigned from Figma's board April 14
- Figma's stock lost another 5% right after Claude Design launched

---

## The New Stack Coverage

Source: https://thenewstack.io/anthropic-claude-design-launch/  
Author: Frederic Lardinois, Published: April 17, 2026

First-person usage notes:
- Claude Design comes with weekly token limits for paid plans; after building a design system and a news website prototype plus tweaks and one explainer video, used over 50% of weekly allotment.
- Option to build a wireframe instead of polished mockup (uses fewer tokens).
- Design system onboarding: Claude chooses colors and fonts, creates design elements, but user gets last word on virtually every aspect — approves or requests changes.
- Can go back and make changes after seeing final results.
- Inline commenting on specific design elements (similar to OpenAI Codex for visual assets).
- Can draw on designs and edit elements directly (background colors, fonts).
- Most interesting: the model generates sliders and options you'd like to see to tweak design in real-time, without having to ask Claude for changes.

---

## GitHub Plugin Repository: knowledge-work-plugins/design

Source: https://github.com/anthropics/knowledge-work-plugins/tree/main/design  
Raw README: https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/README.md

### Plugin Commands (Slash Commands)

| Command | Description |
|---|---|
| `/critique` | Get structured design feedback — usability, visual hierarchy, accessibility, and consistency |
| `/design-system` | Audit, document, or extend your design system — components, tokens, patterns |
| `/handoff` | Generate developer handoff specs — measurements, tokens, states, interactions, and edge cases |
| `/ux-copy` | Write or review UX copy — microcopy, error messages, empty states, onboarding flows |
| `/accessibility` | Run an accessibility audit — WCAG compliance, color contrast, screen reader, and keyboard navigation |
| `/research-synthesis` | Synthesize user research — interviews, surveys, usability tests into actionable insights |

### Plugin Skills (Auto-triggered Domain Knowledge)

| Skill | Description |
|---|---|
| `design-critique` | Evaluate designs for usability, visual hierarchy, consistency, and adherence to design principles |
| `design-system-management` | Manage design tokens, component libraries, and pattern documentation |
| `ux-writing` | Write effective microcopy — clear, concise, consistent, and brand-aligned |
| `accessibility-review` | Audit designs and code for WCAG 2.1 AA compliance |
| `user-research` | Plan, conduct, and synthesize user research — interviews, surveys, usability testing |
| `design-handoff` | Create comprehensive developer handoff documentation from designs |

### MCP Integrations (Connectors)

| Category | Included Servers | Other Options |
|---|---|---|
| Design tool | Figma | Sketch, Adobe XD, Framer |
| Chat | Slack | Microsoft Teams |
| Knowledge base | Notion | Confluence, Guru, Coda |
| Project tracker | Linear, Asana, Atlassian (Jira/Confluence) | Shortcut, ClickUp |
| User feedback | Intercom | Productboard, Canny, UserVoice, Dovetail |
| Product analytics | — | Amplitude, Mixpanel, Heap, FullStory |

### Standalone vs. Supercharged

| Capability | Standalone | Supercharged With |
|---|---|---|
| Design critique | Describe or screenshot | Figma MCP (pull designs directly) |
| Design system | Describe your system | Figma MCP (audit component library) |
| Handoff specs | Describe or screenshot | Figma MCP (exact measurements, tokens) |
| UX copy | Describe the context | Knowledge base (brand voice guidelines) |
| Accessibility | Describe or screenshot | Figma MCP, analytics for real usage data |
| Research synthesis | Paste transcripts | User feedback tools (pull raw data) |

---

## Skill Detail: design-critique (from GitHub)

Critique Framework:
1. First Impression (2 seconds) — What draws the eye, emotional reaction, is purpose clear
2. Usability — Can user accomplish their goal, navigation, interactive elements
3. Visual Hierarchy — Reading order, emphasis, whitespace, typography
4. Consistency — Design system adherence, spacing, colors, typography
5. Accessibility — Color contrast, touch targets, readability, alt text

Output format: Markdown table of findings with severity (Critical/Moderate/Minor) and recommendations.

---

## Skill Detail: design-handoff (from GitHub)

Handoff spec includes:
- Visual Specifications: exact measurements, design token references, responsive breakpoints, component variants/states
- Interaction Specifications: click/tap behavior, hover states, transitions, gesture support
- Content Specifications: character limits, truncation, empty states, loading states, error states
- Edge Cases: min/max content, international text, slow connections, missing data
- Accessibility: focus order, ARIA labels, keyboard interactions, screen reader announcements

Principles:
1. Don't assume — if not specified, developer will guess
2. Use tokens, not values — reference `spacing-md` not `16px`
3. Show all states — default, hover, active, disabled, loading, error, empty
4. Describe the why — helps developers make good judgment calls

---

## Anthropic Labs Context

Source: https://www.anthropic.com/news/introducing-anthropic-labs

- Launched quietly in mid-2024 with 2 people
- Led by Mike Krieger (Instagram co-founder, former Anthropic CPO) and Ben Mann (product engineering lead)
- Krieger reports to Anthropic President Daniela Amodei
- Ami Vora took over the main Product organization
- Labs track record: Claude Code (became $1B product in 6 months), MCP (100M monthly downloads), Cowork (built in 1.5 weeks), Skills, Claude in Chrome
- Planning to double headcount within 6 months

---

## Hacker News Discussion

Source: https://news.ycombinator.com/item?id=47806725  
459 points, 288 comments (at time of fetch)

Key community insight (pilgrim0):
> On Notes on the Synthesis of Form, Alexander defines design as the rationalization of the forces that define a problem... Anyone equipped with a synthesis tool and feeling empowered to quickly and cheaply generate forms will almost inevitably become blind to the very nature of the underlying problems they set to solve.

(Community debate about whether AI design tools help or hinder genuine design thinking.)

---

## Additional Sources

- [9to5Mac coverage](https://9to5mac.com/2026/04/17/anthropic-launches-claude-design-for-mac-following-opus-4-7-model-upgrade/)
- [Yahoo Tech / The Information coverage](https://tech.yahoo.com/ai/claude/articles/anthropic-debuts-claude-design-building-150000621.html)
- [StartupHub.ai coverage](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/anthropic-unveils-claude-design)
- [Canva Newsroom announcement](https://www.canva.com/newsroom/news/canva-claude-design/)
- [X/Twitter announcement by @claudeai](https://x.com/claudeai/status/2045156267690213649)
- [Claude Design plugin page](https://claude.com/plugins/design)
- [Claude plugins directory](https://claude.com/plugins)
