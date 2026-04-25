import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = new URL(".", import.meta.url).pathname;
const WIDTH = 1270;
const HEIGHT = 760;

const palette = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  dim: "#7f849c",
  blue: "#89b4fa",
  sky: "#89dceb",
  teal: "#94e2d5",
  green: "#a6e3a1",
  red: "#f38ba8",
  yellow: "#f9e2af",
  mauve: "#cba6f7",
  peach: "#fab387",
  pink: "#f5c2e7",
};

type TextOptions = {
  size?: number;
  color?: string;
  weight?: number;
  family?: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  spacing?: number;
};

type CodePart = {
  text: string;
  color?: string;
  weight?: number;
};

type CodeLine = {
  line: number;
  parts: CodePart[];
  highlight?: string;
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgText(x: number, y: number, content: string, options: TextOptions = {}): string {
  const size = options.size ?? 24;
  const color = options.color ?? palette.text;
  const weight = options.weight ?? 500;
  const family = options.family ?? "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const anchor = options.anchor ?? "start";
  const opacity = options.opacity ?? 1;
  const spacing = options.spacing ?? 0;
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="${family}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${spacing}">${esc(content)}</text>`;
}

function wrapText(content: string, maxChars: number): string[] {
  const words = content.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function multiText(x: number, y: number, lines: string[], options: TextOptions & { lineHeight?: number } = {}): string {
  const size = options.size ?? 24;
  const lineHeight = options.lineHeight ?? Math.round(size * 1.35);
  return lines.map((line, index) => svgText(x, y + index * lineHeight, line, options)).join("");
}

function card(x: number, y: number, w: number, h: number, fill = palette.surface0, stroke = palette.surface2, opacity = 0.88): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-opacity="0.8"/>`;
}

function pill(x: number, y: number, label: string, color: string, w?: number): string {
  const width = w ?? Math.max(82, label.length * 9 + 28);
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="30" rx="15" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.55"/>
    ${svgText(x + width / 2, y + 20, label, { size: 13, color, weight: 700, anchor: "middle" })}
  </g>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, color = palette.blue, opacity = 0.9): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="${opacity}" marker-end="url(#arrow-${color.slice(1)})"/>`;
}

function node(x: number, y: number, w: number, h: number, label: string, color: string, sublabel?: string): string {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${palette.mantle}" fill-opacity="0.95" stroke="${color}" stroke-opacity="0.72"/>
    <circle cx="${x + 24}" cy="${y + 26}" r="6" fill="${color}"/>
    ${svgText(x + 42, y + 32, label, { size: 18, color: palette.text, weight: 800 })}
    ${sublabel ? multiText(x + 24, y + 61, wrapText(sublabel, 23), { size: 13, color: palette.subtext, weight: 500, lineHeight: 18 }) : ""}
  </g>`;
}

function checklist(x: number, y: number, items: string[], color: string): string {
  return items.map((item, index) => {
    const yy = y + index * 42;
    return `<g>
      <circle cx="${x}" cy="${yy - 5}" r="10" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-opacity="0.7"/>
      ${svgText(x, yy, "✓", { size: 15, color, weight: 900, anchor: "middle", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" })}
      ${svgText(x + 24, yy, item, { size: 18, color: palette.text, weight: 650 })}
    </g>`;
  }).join("");
}

function warningList(x: number, y: number, items: string[]): string {
  return items.map((item, index) => {
    const yy = y + index * 42;
    return `<g opacity="${0.92 - index * 0.035}">
      <circle cx="${x}" cy="${yy - 5}" r="10" fill="${palette.red}" fill-opacity="0.15" stroke="${palette.red}" stroke-opacity="0.65"/>
      ${svgText(x, yy - 1, "!", { size: 14, color: palette.red, weight: 900, anchor: "middle", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" })}
      ${svgText(x + 24, yy, item, { size: 18, color: palette.text, weight: 650 })}
    </g>`;
  }).join("");
}

function codeBlock(x: number, y: number, w: number, h: number, lines: CodeLine[]): string {
  const lineHeight = 24;
  const top = y + 56;
  const rendered = lines.map((entry, index) => {
    const yy = top + index * lineHeight;
    const bg = entry.highlight
      ? `<rect x="${x + 60}" y="${yy - 17}" width="${w - 86}" height="22" rx="6" fill="${entry.highlight}" fill-opacity="0.13" stroke="${entry.highlight}" stroke-opacity="0.28"/>`
      : "";
    let cursor = x + 84;
    const parts = entry.parts.map((part) => {
      const color = part.color ?? palette.subtext;
      const weight = part.weight ?? 520;
      const text = `<text x="${cursor}" y="${yy}" fill="${color}" font-size="15" font-weight="${weight}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace">${esc(part.text)}</text>`;
      cursor += part.text.length * 8.9;
      return text;
    }).join("");
    return `${bg}${svgText(x + 26, yy, String(entry.line).padStart(2, "0"), {
      size: 13,
      color: palette.dim,
      family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      anchor: "end",
    })}${parts}`;
  }).join("");

  return `<g>
    ${card(x, y, w, h, palette.crust, palette.surface2, 0.96)}
    <rect x="${x}" y="${y}" width="${w}" height="38" rx="14" fill="${palette.surface0}" fill-opacity="0.94"/>
    <circle cx="${x + 24}" cy="${y + 19}" r="5" fill="${palette.red}" opacity="0.78"/>
    <circle cx="${x + 43}" cy="${y + 19}" r="5" fill="${palette.yellow}" opacity="0.78"/>
    <circle cx="${x + 62}" cy="${y + 19}" r="5" fill="${palette.green}" opacity="0.78"/>
    ${svgText(x + 88, y + 24, "src/workflows/review-to-merge/claude.ts", { size: 13, color: palette.subtext, weight: 650, family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" })}
    ${rendered}
  </g>`;
}

function base(content: string, title?: string): string {
  const markers = ["89b4fa", "94e2d5", "a6e3a1", "f38ba8", "f9e2af", "cba6f7", "fab387"]
    .map((hex) => `<marker id="arrow-${hex}" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M2 2 L10 6 L2 10" fill="none" stroke="#${hex}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    ${markers}
    <radialGradient id="glow" cx="70%" cy="20%" r="72%">
      <stop offset="0%" stop-color="${palette.blue}" stop-opacity="0.16"/>
      <stop offset="45%" stop-color="${palette.mauve}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${palette.base}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="terminalLine" x1="0" x2="1">
      <stop offset="0%" stop-color="${palette.teal}" stop-opacity="0.9"/>
      <stop offset="55%" stop-color="${palette.blue}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${palette.mauve}" stop-opacity="0.75"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
    <filter id="tight-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.base}"/>
  <image href="atomic-backdrop.png" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice" opacity="0.34"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.base}" opacity="0.28"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <path d="M70 106 H238 L285 146 H414" stroke="${palette.surface2}" stroke-width="1.4" fill="none" opacity="0.34"/>
  <path d="M1080 650 H934 L896 610 H766" stroke="${palette.surface2}" stroke-width="1.4" fill="none" opacity="0.32"/>
  ${title ? svgText(64, 42, "ATOMIC", { size: 16, color: palette.teal, weight: 900, family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", spacing: 2 }) : ""}
  ${content}
</svg>`;
}

function hero(): string {
  const flowY = 430;
  const content = `
    ${svgText(66, 158, "Turn coding agents into", { size: 54, color: palette.text, weight: 850 })}
    ${svgText(66, 220, "reliable engineering workflows", { size: 54, color: palette.teal, weight: 850 })}
    ${multiText(70, 282, ["Atomic is not another coding agent.", "It is the structure around the agent."], { size: 21, color: palette.subtext, weight: 550, lineHeight: 32 })}
    ${pill(70, 334, "TypeScript workflows", palette.blue, 176)}
    ${pill(264, 334, "review gates", palette.yellow, 126)}
    ${pill(408, 334, "parallel sessions", palette.teal, 158)}

    <g filter="url(#soft-shadow)">
      ${node(74, flowY, 206, 126, "Prompt chaos", palette.red, "manual reminders, context switching, unclear state")}
      ${arrow(290, flowY + 64, 390, flowY + 64, palette.red, 0.55)}
      ${node(410, flowY - 18, 244, 162, "Atomic workflow", palette.blue, "define stages, branches, gates, and isolated execution")}
      ${arrow(666, flowY + 64, 766, flowY + 64, palette.blue, 0.9)}
      ${node(764, flowY, 238, 126, "Agent execution", palette.teal, "visible sessions running the work")}
      ${arrow(1012, flowY + 64, 1060, flowY + 64, palette.green, 0.9)}
      ${node(1070, flowY, 164, 126, "Safe output", palette.green, "PR, report, or reviewed patch")}
    </g>

    <g transform="translate(710 116)" opacity="0.95">
      <circle cx="244" cy="132" r="35" fill="${palette.blue}" fill-opacity="0.22" stroke="${palette.blue}" stroke-opacity="0.7"/>
      <ellipse cx="244" cy="132" rx="142" ry="42" fill="none" stroke="${palette.teal}" stroke-width="5" opacity="0.82" transform="rotate(22 244 132)"/>
      <ellipse cx="244" cy="132" rx="142" ry="42" fill="none" stroke="${palette.blue}" stroke-width="5" opacity="0.74" transform="rotate(-24 244 132)"/>
      <ellipse cx="244" cy="132" rx="76" ry="154" fill="none" stroke="${palette.mauve}" stroke-width="4" opacity="0.58" transform="rotate(8 244 132)"/>
      <circle cx="132" cy="76" r="10" fill="${palette.teal}" filter="url(#tight-glow)"/>
      <circle cx="352" cy="204" r="10" fill="${palette.blue}" filter="url(#tight-glow)"/>
      <circle cx="306" cy="24" r="8" fill="${palette.mauve}" filter="url(#tight-glow)"/>
    </g>
  `;
  return base(content, "hero");
}

function workflowAsCode(): string {
  const lines: CodeLine[] = [
    { line: 1, parts: [{ text: 'import { defineWorkflow } from "', color: palette.mauve }, { text: "@bastani/atomic/workflows", color: palette.green }, { text: '";', color: palette.mauve }] },
    { line: 2, parts: [{ text: "" }] },
    { line: 3, parts: [{ text: "export default defineWorkflow", color: palette.mauve }, { text: "({", color: palette.subtext }] },
    { line: 4, parts: [{ text: '  name: "review-to-merge",', color: palette.sky }], highlight: palette.blue },
    { line: 5, parts: [{ text: '  devcontainer: ".devcontainer/claude.json",', color: palette.yellow }], highlight: palette.yellow },
    { line: 6, parts: [{ text: "})", color: palette.subtext }, { text: ".for", color: palette.mauve }, { text: '("claude")', color: palette.green }] },
    { line: 7, parts: [{ text: "  .run", color: palette.mauve }, { text: "(async (ctx) => {", color: palette.subtext }] },
    { line: 8, parts: [{ text: "    const review = await ctx.", color: palette.subtext }, { text: "stage", color: palette.blue }, { text: "({ name: ", color: palette.subtext }, { text: '"review"', color: palette.green }, { text: " }, ...);", color: palette.subtext }], highlight: palette.blue },
    { line: 9, parts: [{ text: "    if", color: palette.mauve }, { text: " (review.result.needsDesign) {", color: palette.subtext }], highlight: palette.mauve },
    { line: 10, parts: [{ text: "      await ctx.stage({ name: ", color: palette.subtext }, { text: '"ux-review"', color: palette.green }, { text: " }, ...);", color: palette.subtext }] },
    { line: 11, parts: [{ text: "    }", color: palette.subtext }] },
    { line: 12, parts: [{ text: "    await Promise.", color: palette.subtext }, { text: "all", color: palette.teal }, { text: "([", color: palette.subtext }], highlight: palette.teal },
    { line: 13, parts: [{ text: "      ctx.stage({ name: ", color: palette.subtext }, { text: '"security-scan"', color: palette.green }, { text: " }, ...),", color: palette.subtext }] },
    { line: 14, parts: [{ text: "      ctx.stage({ name: ", color: palette.subtext }, { text: '"ci-checks"', color: palette.green }, { text: " }, ...),", color: palette.subtext }] },
    { line: 15, parts: [{ text: "    ]);", color: palette.subtext }] },
    { line: 16, parts: [{ text: "    await ctx.stage({ name: ", color: palette.subtext }, { text: '"human-approval"', color: palette.yellow }, { text: " }, ...);", color: palette.subtext }], highlight: palette.yellow },
    { line: 17, parts: [{ text: "  })", color: palette.subtext }] },
    { line: 18, parts: [{ text: "  .compile();", color: palette.subtext }] },
  ];

  const content = `
    ${svgText(64, 92, "Workflow-as-code", { size: 42, color: palette.text, weight: 850 })}
    ${svgText(66, 128, "Developer-native orchestration that lives in the repo.", { size: 19, color: palette.subtext, weight: 560 })}
    ${codeBlock(64, 164, 728, 520, lines)}

    <g filter="url(#soft-shadow)">
      ${card(830, 164, 360, 520, palette.mantle, palette.surface2, 0.94)}
      ${svgText(858, 214, "What the file encodes", { size: 25, color: palette.text, weight: 820 })}
      ${checklist(872, 266, ["steps as ctx.stage()", "branching with if/else", "human-in-the-loop gate", "parallel agent sessions", "devcontainer config"], palette.green)}
      <rect x="858" y="528" width="296" height="118" rx="12" fill="${palette.surface0}" fill-opacity="0.68" stroke="${palette.blue}" stroke-opacity="0.45"/>
      ${svgText(882, 562, "No black-box canvas.", { size: 22, color: palette.blue, weight: 820 })}
      ${multiText(882, 592, ["Review it in Git.", "Run it with Bun.", "Reuse it across the team."], { size: 16, color: palette.subtext, weight: 560, lineHeight: 23 })}
    </g>
  `;
  return base(content, "workflow");
}

function beforeAfter(): string {
  const content = `
    ${svgText(64, 92, "The pain is operational control", { size: 42, color: palette.text, weight: 850 })}
    ${svgText(66, 128, "Agents can code. Atomic makes longer agent runs reviewable, repeatable, and safer.", { size: 19, color: palette.subtext, weight: 560 })}

    <g filter="url(#soft-shadow)">
      ${card(70, 184, 520, 486, palette.mantle, palette.red, 0.9)}
      ${svgText(104, 240, "Before", { size: 38, color: palette.red, weight: 850 })}
      ${warningList(118, 304, ["Manual prompting", "Repeated reminders", "Context switching", "Unclear state", "Unsafe execution"])}
      <path d="M390 300 C450 274 492 332 452 378 C416 419 488 464 438 516 C394 562 480 604 526 570" fill="none" stroke="${palette.red}" stroke-width="3" opacity="0.38"/>
      <path d="M382 360 C438 328 482 386 432 426 C392 458 442 500 504 486" fill="none" stroke="${palette.mauve}" stroke-width="2" opacity="0.3"/>
    </g>

    <g filter="url(#soft-shadow)">
      ${card(680, 184, 520, 486, palette.mantle, palette.green, 0.9)}
      ${svgText(714, 240, "After", { size: 38, color: palette.green, weight: 850 })}
      ${checklist(728, 304, ["Defined workflow", "Guardrails", "Review gates", "Parallel runs", "Devcontainer"], palette.green)}
      ${node(970, 294, 154, 72, "workflow.ts", palette.blue)}
      ${node(890, 414, 132, 70, "agent A", palette.teal)}
      ${node(1050, 414, 132, 70, "agent B", palette.teal)}
      ${node(970, 544, 154, 72, "review gate", palette.yellow)}
      ${arrow(1047, 368, 956, 414, palette.blue)}
      ${arrow(1047, 368, 1116, 414, palette.blue)}
      ${arrow(956, 486, 1038, 544, palette.teal)}
      ${arrow(1116, 486, 1070, 544, palette.teal)}
    </g>
  `;
  return base(content, "before-after");
}

function useCases(): string {
  const cases = [
    ["PR UX review", palette.mauve, ["scan diff", "run reviewer", "file notes"]],
    ["Support ticket to draft PR", palette.blue, ["read ticket", "trace code", "draft patch"]],
    ["Production alert investigation", palette.red, ["inspect logs", "hypothesize", "report fix"]],
    ["Multi-persona product feedback", palette.teal, ["design", "eng", "support"]],
  ] as const;

  const cards = cases.map(([title, color, steps], index) => {
    const x = 74 + index * 296;
    return `<g filter="url(#soft-shadow)">
      ${card(x, 228, 250, 372, palette.mantle, color, 0.92)}
      <circle cx="${x + 42}" cy="278" r="14" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-opacity="0.8"/>
      ${svgText(x + 42, 284, String(index + 1), { size: 16, color, weight: 900, anchor: "middle", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" })}
      ${multiText(x + 28, 338, wrapText(title, 20), { size: 25, color: palette.text, weight: 850, lineHeight: 31 })}
      ${steps.map((step, stepIndex) => {
        const y = 430 + stepIndex * 54;
        return `<g>
          <rect x="${x + 30}" y="${y - 26}" width="188" height="34" rx="9" fill="${palette.surface0}" fill-opacity="0.72" stroke="${color}" stroke-opacity="0.3"/>
          ${svgText(x + 50, y - 3, step, { size: 15, color: palette.subtext, weight: 650 })}
        </g>`;
      }).join("")}
      ${arrow(x + 124, 442, x + 124, 470, color, 0.7)}
      ${arrow(x + 124, 496, x + 124, 524, color, 0.7)}
    </g>`;
  }).join("");

  const content = `
    ${svgText(64, 92, "Workflows for ambiguous engineering work", { size: 42, color: palette.text, weight: 850 })}
    ${svgText(66, 128, "Reusable patterns for tasks that need context, judgment, and controlled execution.", { size: 19, color: palette.subtext, weight: 560 })}
    ${cards}
    ${svgText(635, 672, "Define once. Run with Claude Code, OpenCode, or GitHub Copilot CLI.", { size: 20, color: palette.blue, weight: 760, anchor: "middle" })}
  `;
  return base(content, "use-cases");
}

function architecture(): string {
  const centerX = 635;
  const content = `
    ${svgText(64, 92, "Atomic enhances your existing agent harness", { size: 42, color: palette.text, weight: 850 })}
    ${svgText(66, 128, "It wraps the tools developers already use with TypeScript workflow structure.", { size: 19, color: palette.subtext, weight: 560 })}

    <g filter="url(#soft-shadow)">
      ${node(460, 178, 350, 74, "Your repo", palette.blue, "code, tests, docs, agent config")}
      ${arrow(centerX, 258, centerX, 310, palette.blue)}
      ${node(426, 320, 418, 82, "Atomic TypeScript workflow", palette.teal, "defineWorkflow, ctx.stage, Promise.all, gates")}
      ${arrow(centerX, 408, centerX, 460, palette.teal)}
      ${node(126, 470, 288, 86, "Claude Code", palette.mauve, "native CLI + SDK session")}
      ${node(491, 470, 288, 86, "OpenCode", palette.blue, "native CLI + SDK session")}
      ${node(856, 470, 288, 86, "Copilot CLI", palette.teal, "native CLI + SDK session")}
      ${arrow(centerX, 408, 270, 470, palette.teal, 0.7)}
      ${arrow(centerX, 408, 635, 470, palette.teal, 0.9)}
      ${arrow(centerX, 408, 1000, 470, palette.teal, 0.7)}
      ${arrow(270, 560, centerX - 115, 628, palette.yellow, 0.55)}
      ${arrow(635, 560, centerX, 628, palette.yellow, 0.9)}
      ${arrow(1000, 560, centerX + 115, 628, palette.yellow, 0.55)}
      ${node(398, 630, 474, 74, "Tools, codebase, devcontainer, review gate, PR, report", palette.yellow)}
    </g>
  `;
  return base(content, "architecture");
}

function safety(): string {
  const content = `
    ${svgText(64, 92, "Run longer workflows with a lower blast radius", { size: 42, color: palette.text, weight: 850 })}
    ${svgText(66, 128, "Atomic supports isolated devcontainers so agent execution does not have to happen directly on your host.", { size: 19, color: palette.subtext, weight: 560 })}

    <g filter="url(#soft-shadow)">
      ${card(92, 214, 430, 384, palette.mantle, palette.surface2, 0.94)}
      ${svgText(128, 268, "Host machine", { size: 30, color: palette.text, weight: 850 })}
      ${svgText(128, 304, "source of truth", { size: 16, color: palette.subtext, weight: 650 })}
      <rect x="146" y="360" width="300" height="126" rx="16" fill="${palette.surface0}" stroke="${palette.red}" stroke-opacity="0.55" fill-opacity="0.68"/>
      ${svgText(296, 414, "direct agent execution", { size: 20, color: palette.red, weight: 800, anchor: "middle" })}
      ${svgText(296, 446, "higher risk surface", { size: 15, color: palette.subtext, weight: 600, anchor: "middle" })}
    </g>

    ${arrow(544, 406, 706, 406, palette.yellow, 0.8)}
    ${pill(558, 366, "isolate", palette.yellow, 104)}

    <g filter="url(#soft-shadow)">
      <rect x="734" y="184" width="440" height="444" rx="22" fill="${palette.mantle}" fill-opacity="0.94" stroke="${palette.teal}" stroke-opacity="0.68"/>
      <rect x="778" y="250" width="352" height="250" rx="18" fill="${palette.surface0}" fill-opacity="0.58" stroke="${palette.teal}" stroke-opacity="0.46" stroke-dasharray="10 8"/>
      ${svgText(790, 224, "Devcontainer boundary", { size: 29, color: palette.teal, weight: 850 })}
      ${node(818, 292, 274, 74, "Atomic workflow", palette.blue, "orchestrates stages")}
      ${node(818, 408, 274, 74, "Agent sessions", palette.teal, "tools run inside container")}
      ${arrow(956, 372, 956, 408, palette.blue)}
      <rect x="810" y="540" width="302" height="44" rx="12" fill="${palette.green}" fill-opacity="0.13" stroke="${palette.green}" stroke-opacity="0.5"/>
      ${svgText(961, 568, "lower blast radius", { size: 18, color: palette.green, weight: 850, anchor: "middle" })}
    </g>

    ${multiText(118, 642, ["The concern is real: agents doing more need better boundaries.", "Atomic gives the workflow a safer place to run."], { size: 19, color: palette.subtext, weight: 560, lineHeight: 29 })}
  `;
  return base(content, "safety");
}

const assets = [
  ["01-hero-image.svg", hero()],
  ["02-workflow-as-code.svg", workflowAsCode()],
  ["03-before-after.svg", beforeAfter()],
  ["04-use-case-carousel.svg", useCases()],
  ["05-architecture-diagram.svg", architecture()],
  ["06-safety-devcontainer.svg", safety()],
] as const;

mkdirSync(OUT_DIR, { recursive: true });
for (const [filename, contents] of assets) {
  writeFileSync(join(OUT_DIR, filename), contents);
}

console.log(`Wrote ${assets.length} SVG assets to ${OUT_DIR}`);
