/**
 * Validation helpers for the open-claude-design workflow refinement loop.
 *
 * Parses critique and screenshot validation outputs from headless sub-agents,
 * determines exit conditions, and merges results. Modeled on the bounded
 * refinement loop pattern from the Ralph workflow.
 *
 * All functions are pure (no side effects).
 */

// ============================================================================
// TYPES
// ============================================================================

export type FindingSeverity = "critical" | "moderate" | "minor";

export interface ValidationFinding {
  severity: FindingSeverity;
  category: string;
  description: string;
  suggestion?: string;
}

export interface ValidationSummary {
  criticalCount: number;
  moderateCount: number;
  minorCount: number;
  findings: ValidationFinding[];
  critiqueRaw: string;
  screenshotRaw: string;
}

// ============================================================================
// TYPES — Session message narrowing (mirrors claude.ts patterns)
// ============================================================================

/**
 * Minimal shape of a SessionMessage content block for tool_use / tool_result
 * inspection. The SDK types use `unknown` for the message payload, so we
 * narrow at runtime exactly like `_hasUnresolvedHILTool` in claude.ts.
 */
interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  text?: string;
}

export interface SessionMessageLike {
  type: string;
  message?: { content?: ContentBlock[] | unknown } | unknown;
}

/**
 * The refinement loop exit decision. Modeled on Ralph's
 * `StructuredReviewResult` — a structured object returned from the stage
 * callback so the orchestrator can make a control-flow decision.
 */
export interface RefinementDecision {
  /** true when the user chose "Done, looks good." — exits the refinement loop. */
  done: boolean;
  /** true when the user chose "Run validation checks." — exits the current
   *  stage to run headless critique + screenshot, then starts a new stage. */
  validate: boolean;
  /** User's feedback text when they chose "I have more changes.", otherwise null.
   *  Used by the orchestrator's inner multi-turn loop to continue the conversation. */
  feedback: string | null;
}

// ============================================================================
// extractToolResultText — low-level tool_result reader
// ============================================================================

/**
 * Extract the text content from a tool_result content block.
 * Handles both string content and array-of-text-blocks formats.
 */
function extractToolResultText(block: ContentBlock): string | null {
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n");
  }
  return null;
}

// ============================================================================
// extractAllAskUserResponses
// ============================================================================

/**
 * Extract ALL resolved AskUserQuestion tool_result responses from the
 * session transcript, in order. Returns an array of the user's raw text
 * for each resolved AskUserQuestion.
 */
function extractAllAskUserResponses(
  messages: ReadonlyArray<SessionMessageLike>,
): string[] {
  // Collect all AskUserQuestion tool_use IDs in order.
  const askToolUses: { id: string; index: number }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.type !== "assistant") continue;
    const content = (msg.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as ContentBlock[]) {
      if (block.type === "tool_use" && block.name === "AskUserQuestion" && block.id) {
        askToolUses.push({ id: block.id, index: i });
      }
    }
  }

  // Resolve each tool_use to its tool_result.
  const responses: string[] = [];
  for (const ask of askToolUses) {
    for (let i = ask.index + 1; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.type !== "user") continue;
      const content = (msg.message as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as ContentBlock[]) {
        if (block.type === "tool_result" && block.tool_use_id === ask.id) {
          const text = extractToolResultText(block);
          if (text !== null) responses.push(text);
        }
      }
    }
  }

  return responses;
}

// ============================================================================
// parseRefinementDecision — 3-strategy cascade (modeled on Ralph's parseReviewResult)
// ============================================================================

/**
 * Parse the refinement decision from session messages using a 3-strategy
 * cascade, modeled on Ralph's `parseReviewResult`:
 *
 *   Strategy 1 (structured): Read AskUserQuestion tool_result content
 *     blocks directly from session messages. The first response is the
 *     user's choice ("1" = done, "2" = feedback). If "2", the second
 *     response contains the feedback text.
 *
 *   Strategy 2 (JSON from agent text): Look for a JSON block in the
 *     agent's text output matching `{"decision": "done"|"continue", ...}`.
 *
 *   Strategy 3 (regex from agent text): Pattern-match the agent's text
 *     for decision indicators.
 *
 *   Default: If all strategies fail, return `{ done: false, feedback: null }`
 *     (conservative — don't exit the loop on ambiguous data).
 *
 * Pure function — no side effects.
 */
export function parseRefinementDecision(
  messages: ReadonlyArray<SessionMessageLike>,
): RefinementDecision {
  // ── Strategy 1: Structured tool_result extraction ──────────────────────
  const responses = extractAllAskUserResponses(messages);
  if (responses.length > 0) {
    const choice = responses[0]!.trim();
    // User selected option 1 ("Done, looks good.")
    if (choice === "1" || choice.toLowerCase().startsWith("1")) {
      return { done: true, validate: false, feedback: null };
    }
    // User selected option 2 ("Run validation checks.")
    if (choice === "2" || choice.toLowerCase().startsWith("2")) {
      return { done: false, validate: true, feedback: null };
    }
    // User selected option 3 ("I have more changes.")
    // The feedback is in the second AskUserQuestion response.
    if (choice === "3" || choice.toLowerCase().startsWith("3")) {
      const feedback = responses.length > 1 ? responses[1]! : null;
      return { done: false, validate: false, feedback };
    }
    // User typed something other than "1", "2", or "3" — treat as inline feedback.
    return { done: false, validate: false, feedback: choice };
  }

  // ── Strategy 2: JSON from agent text ───────────────────────────────────
  // If we reach here, the agent did NOT call AskUserQuestion. Log a warning
  // so this failure mode is visible in workflow logs.
  console.warn(
    "[open-claude-design] WARNING: AskUserQuestion tool was not called during " +
    "refinement. Falling back to JSON/regex extraction from agent text. " +
    "The user was NOT prompted for input.",
  );
  const agentText = extractAssistantTextFromMessages(messages);
  const jsonDecision = parseDecisionJSON(agentText);
  if (jsonDecision) return jsonDecision;

  // ── Strategy 3: Regex from agent text ──────────────────────────────────
  const regexDecision = parseDecisionRegex(agentText);
  if (regexDecision) return regexDecision;

  // ── Default: conservative — stay in multi-turn, don't exit the stage ───
  return { done: false, validate: false, feedback: null };
}

// ============================================================================
// Strategy 2 helpers — JSON extraction
// ============================================================================

/**
 * Extract assistant text from messages (simplified version for internal use).
 */
function extractAssistantTextFromMessages(
  messages: ReadonlyArray<SessionMessageLike>,
): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    const content = (msg.message as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as ContentBlock[]) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Try to parse a RefinementDecision from a JSON block in agent text.
 * Mirrors Ralph's `parseReviewResult` strategy 1+2 (direct parse, then
 * last fenced code block).
 */
function parseDecisionJSON(agentText: string): RefinementDecision | null {
  // Strategy 2a: last fenced JSON block
  const blockRe = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let lastBlock: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(agentText)) !== null) {
    if (match[1]) lastBlock = match[1];
  }
  if (lastBlock !== null) {
    const result = tryParseDecision(lastBlock);
    if (result) return result;
  }

  // Strategy 2b: last "{...decision...}" object in prose
  const objRe = /\{[\s\S]*?"decision"[\s\S]*?\}/g;
  let lastObj: string | null = null;
  while ((match = objRe.exec(agentText)) !== null) {
    lastObj = match[0];
  }
  if (lastObj !== null) {
    const result = tryParseDecision(lastObj);
    if (result) return result;
  }

  return null;
}

function tryParseDecision(raw: string): RefinementDecision | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.decision === "string") {
      const decision = parsed.decision.toLowerCase();
      if (decision === "done") return { done: true, validate: false, feedback: null };
      if (decision === "validate") return { done: false, validate: true, feedback: null };
      if (decision === "continue") {
        return {
          done: false,
          validate: false,
          feedback: typeof parsed.feedback === "string" ? parsed.feedback : null,
        };
      }
    }
  } catch { /* fall through */ }
  return null;
}

// ============================================================================
// Strategy 3 helpers — Regex
// ============================================================================

const DONE_PATTERNS = [
  /user\s+(?:chose|selected|picked)\s+(?:option\s+)?1/i,
  /(?:done|satisfied|approved|proceed\s+to\s+export)/i,
];

const VALIDATE_PATTERNS = [
  /user\s+(?:chose|selected|picked)\s+(?:option\s+)?2/i,
  /(?:run\s+validation|validate|validation\s+checks?)/i,
];

const CONTINUE_PATTERNS = [
  /user\s+(?:chose|selected|picked)\s+(?:option\s+)?3/i,
  /user\s+(?:has\s+)?(?:further\s+)?feedback/i,
  /(?:changes?\s+requested|wants?\s+(?:to\s+)?(?:change|modify|adjust))/i,
  /(?:more\s+changes?|additional\s+changes?)/i,
];

function parseDecisionRegex(agentText: string): RefinementDecision | null {
  // Check continue patterns first (conservative — prefer staying in multi-turn)
  for (const re of CONTINUE_PATTERNS) {
    if (re.test(agentText)) return { done: false, validate: false, feedback: null };
  }
  for (const re of VALIDATE_PATTERNS) {
    if (re.test(agentText)) return { done: false, validate: true, feedback: null };
  }
  for (const re of DONE_PATTERNS) {
    if (re.test(agentText)) return { done: true, validate: false, feedback: null };
  }
  return null;
}

// ============================================================================
// parseCritiqueFindings
// ============================================================================

/**
 * Regex patterns for parsing severity markers from critique output.
 * Supports bracket style [Critical], bold style **Critical**, and
 * combined bold-bracket style **[Critical]** (used by the critique prompt).
 */
const SEVERITY_LINE_RE =
  /(?:\*\*\[|\[|\*\*)(critical|moderate|minor)(?:\]\*\*|\]|\*\*)\s+([^:\n]+):\s*(.+)/gi;

/**
 * Parse structured critique output from the reviewer agent.
 *
 * Looks for severity markers in three formats:
 *   - Bracket: [Critical], [Moderate], [Minor]
 *   - Bold: **Critical**, **Moderate**, **Minor**
 *   - Bold-bracket: **[Critical]**, **[Moderate]**, **[Minor]**
 * Extracts category and description text.
 * Returns empty array if no structured findings found.
 */
export function parseCritiqueFindings(critiqueOutput: string): ValidationFinding[] {
  if (!critiqueOutput.trim()) {
    return [];
  }

  const findings: ValidationFinding[] = [];
  const re = new RegExp(SEVERITY_LINE_RE.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = re.exec(critiqueOutput)) !== null) {
    const rawSeverity = match[1]!.toLowerCase();
    const severity = rawSeverity as FindingSeverity;
    const category = match[2]!.trim();
    const description = match[3]!.trim();

    findings.push({ severity, category, description });
  }

  return findings;
}

// ============================================================================
// parseScreenshotFindings
// ============================================================================

/**
 * Keywords that indicate a viewport-specific or rendering issue in screenshot output.
 */
const VIEWPORT_PATTERNS: RegExp[] = [
  /mobile\s*\(?\d+px\)?[:\s]+(.+)/gi,
  /tablet\s*\(?\d+px\)?[:\s]+(.+)/gi,
  /desktop\s*\(?\d+px\)?[:\s]+(.+)/gi,
  /layout\s+break[:\s]+(.+)/gi,
  /rendering\s+issue[:\s]+(.+)/gi,
  /layout\s+break\s+detected[:\s]+(.+)/gi,
];

/** Negative patterns — lines that indicate no issues. */
const NO_ISSUE_PATTERNS: RegExp[] = [
  /all\s+viewports?\s+(look|render|appear)\s+(great|good|fine|correct|ok)/i,
  /no\s+issues?\s+found/i,
  /no\s+rendering\s+issues?/i,
  /renders?\s+correctly/i,
];

/**
 * Determine the severity of a screenshot finding based on its description.
 * Layout breaks are critical; rendering artifacts are moderate; others are minor.
 */
function screenshotFindingSeverity(description: string): FindingSeverity {
  const lower = description.toLowerCase();
  if (lower.includes("break") || lower.includes("overflow") || lower.includes("overlap")) {
    return "critical";
  }
  if (lower.includes("rendering") || lower.includes("artifact") || lower.includes("not loaded")) {
    return "moderate";
  }
  return "minor";
}

/**
 * Determine the category of a screenshot finding based on its viewport source.
 */
function screenshotFindingCategory(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("mobile")) return "Mobile Viewport";
  if (lower.includes("tablet")) return "Tablet Viewport";
  if (lower.includes("desktop")) return "Desktop Viewport";
  if (lower.includes("layout break")) return "Layout";
  if (lower.includes("rendering")) return "Rendering";
  return "Visual Validation";
}

/**
 * Parse screenshot validation output. Looks for viewport-specific issues,
 * layout break indicators, and rendering issue descriptions.
 * Maps to ValidationFinding with appropriate severity.
 */
export function parseScreenshotFindings(screenshotOutput: string): ValidationFinding[] {
  if (!screenshotOutput.trim()) {
    return [];
  }

  // Check if the output indicates no issues
  for (const pattern of NO_ISSUE_PATTERNS) {
    if (pattern.test(screenshotOutput)) {
      return [];
    }
  }

  const findings: ValidationFinding[] = [];

  for (const pattern of VIEWPORT_PATTERNS) {
    const re = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;

    while ((match = re.exec(screenshotOutput)) !== null) {
      const description = match[1]!.trim();
      if (!description) continue;

      // Find the full line for category detection
      const matchStart = match.index;
      const lineStart = screenshotOutput.lastIndexOf("\n", matchStart) + 1;
      const lineEnd = screenshotOutput.indexOf("\n", matchStart);
      const fullLine = screenshotOutput.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

      findings.push({
        severity: screenshotFindingSeverity(description),
        category: screenshotFindingCategory(fullLine),
        description,
      });
    }
  }

  return findings;
}

// ============================================================================
// mergeValidationResults
// ============================================================================

/**
 * Combine both validation streams (critique + screenshot) into a single summary.
 *
 * Parses both outputs, merges findings into a single array, counts severities,
 * and stores raw outputs for traceability.
 */
export function mergeValidationResults(
  critiqueOutput: string,
  screenshotOutput: string,
): ValidationSummary {
  const critiqueFindings = parseCritiqueFindings(critiqueOutput);
  const screenshotFindings = parseScreenshotFindings(screenshotOutput);
  const allFindings = [...critiqueFindings, ...screenshotFindings];

  let criticalCount = 0;
  let moderateCount = 0;
  let minorCount = 0;

  for (const finding of allFindings) {
    if (finding.severity === "critical") criticalCount++;
    else if (finding.severity === "moderate") moderateCount++;
    else minorCount++;
  }

  return {
    criticalCount,
    moderateCount,
    minorCount,
    findings: allFindings,
    critiqueRaw: critiqueOutput,
    screenshotRaw: screenshotOutput,
  };
}

// ============================================================================
// isValidationClean
// ============================================================================

/**
 * Returns true only if criticalCount === 0.
 * Moderate and minor findings are acceptable and do not block export.
 */
export function isValidationClean(summary: ValidationSummary): boolean {
  return summary.criticalCount === 0;
}

// ============================================================================
// formatValidationForRefiner
// ============================================================================

/**
 * Format validation summary as markdown for injection into the next refinement prompt.
 *
 * Includes:
 * - Summary counts (X critical, Y moderate, Z minor)
 * - Grouped findings by severity (critical first)
 * - Raw critique excerpt if available
 */
export function formatValidationForRefiner(summary: ValidationSummary): string {
  const parts: string[] = [];

  // Header
  parts.push("## Validation Results\n");

  // Summary line
  parts.push(
    `**Summary:** ${summary.criticalCount} critical, ${summary.moderateCount} moderate, ${summary.minorCount} minor\n`,
  );

  // Group findings by severity: critical → moderate → minor
  const severityOrder: FindingSeverity[] = ["critical", "moderate", "minor"];
  const grouped: Record<FindingSeverity, ValidationFinding[]> = {
    critical: [],
    moderate: [],
    minor: [],
  };

  for (const finding of summary.findings) {
    grouped[finding.severity].push(finding);
  }

  for (const severity of severityOrder) {
    const group = grouped[severity];
    if (group.length === 0) continue;

    parts.push(`### ${capitalize(severity)} Findings\n`);
    for (const finding of group) {
      parts.push(`- **[${finding.category}]** ${finding.description}`);
      if (finding.suggestion) {
        parts.push(`  - _Suggestion:_ ${finding.suggestion}`);
      }
    }
    parts.push("");
  }

  // Raw critique excerpt (first 500 chars to keep prompt bounded)
  if (summary.critiqueRaw.trim()) {
    const excerpt = summary.critiqueRaw.trim().slice(0, 500);
    const truncated = summary.critiqueRaw.trim().length > 500 ? `${excerpt}…` : excerpt;
    parts.push("### Critique Excerpt\n");
    parts.push(`> ${truncated.replace(/\n/g, "\n> ")}\n`);
  }

  return parts.join("\n");
}

// ============================================================================
// INTERNAL UTILITIES
// ============================================================================

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
