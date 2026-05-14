/**
 * Project-local workflow fixtures converted from flora131/atomic/examples.
 *
 * These are intentionally kept under .pi/workflows so the real pi extension,
 * the non-interactive SDK entrypoint, and discovery tests all exercise the
 * same project-local loading path.
 */

import { defineWorkflow } from "../../src/index.js";

type LanguageFacts = {
  readonly language: string;
  readonly primaryUse: string;
  readonly strengths: readonly string[];
};

function parseLanguageFacts(raw: string, fallbackLanguage: string): LanguageFacts {
  try {
    const parsed = JSON.parse(raw) as Partial<LanguageFacts>;
    return {
      language: typeof parsed.language === "string" ? parsed.language : fallbackLanguage,
      primaryUse: typeof parsed.primaryUse === "string" ? parsed.primaryUse : "general software",
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return {
      language: fallbackLanguage,
      primaryUse: raw.slice(0, 120),
      strengths: ["received non-json assistant output"],
    };
  }
}

export const atomicExampleHelloWorld = defineWorkflow("atomic-example-hello-world")
  .description("Converted hello-world example: greet someone by name.")
  .input("who", {
    type: "text",
    default: "world",
    description: "Who to greet.",
  })
  .run(async (ctx) => {
    const who = String(ctx.inputs.who ?? "world");
    const greeting = await ctx.stage("greet").prompt(`Say a one-line hello to ${who}.`);
    return { greeting };
  })
  .compile();

export const atomicExampleGoodbye = defineWorkflow("atomic-example-goodbye")
  .description("Converted multi-workflow goodbye example.")
  .input("tone", {
    type: "select",
    choices: ["formal", "casual", "melodramatic"],
    default: "casual",
    description: "Tone of the farewell.",
  })
  .run(async (ctx) => {
    const tone = String(ctx.inputs.tone ?? "casual");
    const farewell = await ctx.stage("farewell").prompt(`Say a one-line ${tone} goodbye.`);
    return { farewell, tone };
  })
  .compile();

export const atomicExampleCommanderEmbedGreet = defineWorkflow(
  "atomic-example-commander-embed-greet",
)
  .description("Converted commander-embed workflow: greet via an embedded CLI command.")
  .input("who", {
    type: "text",
    default: "world",
    description: "Who to greet.",
  })
  .run(async (ctx) => {
    const who = String(ctx.inputs.who ?? "world");
    const greeting = await ctx.stage("greet").prompt(`Say a one-line hello to ${who}.`);
    return { greeting };
  })
  .compile();

export const atomicExampleExplainFile = defineWorkflow("atomic-example-explain-file")
  .description("Converted custom-workflow-bunx example: explain a file path in one stage.")
  .input("path", {
    type: "text",
    required: true,
    default: "src/index.ts",
    description: "Absolute or relative path to the file to explain.",
  })
  .run(async (ctx) => {
    const path = String(ctx.inputs.path ?? "src/index.ts");
    const explanation = await ctx.stage("explain").prompt(
      [
        `Read ${path} and walk me through what it does.`,
        "Highlight any non-obvious behavior or invariants.",
        "Keep it under 10 short sentences.",
      ].join(" "),
    );
    return { path, explanation };
  })
  .compile();

export const atomicExampleSequentialDescribeSummarize = defineWorkflow(
  "atomic-example-sequential-describe-summarize",
)
  .description("Converted sequential example: describe a topic, then summarize it.")
  .input("topic", {
    type: "text",
    required: true,
    default: "TypeScript",
    description: "Topic to describe and summarize.",
  })
  .run(async (ctx) => {
    const topic = String(ctx.inputs.topic ?? "TypeScript");
    const description = await ctx.stage("describe").prompt(
      `Write one detailed paragraph explaining ${topic} to an engineering audience.`,
    );
    const summary = await ctx.stage("summarize").prompt(
      `Condense this description into exactly two bullet points:\n\n${description}`,
    );
    return { description, summary };
  })
  .compile();

export const atomicExampleParallelHelloWorld = defineWorkflow("atomic-example-parallel-hello-world")
  .description("Converted parallel hello-world example: greet, fork formal/casual, merge.")
  .input("topic", {
    type: "text",
    required: true,
    description: "What the greeting should be about.",
  })
  .input("tone", {
    type: "select",
    choices: ["warm", "neutral", "cold"],
    default: "warm",
    description: "Overall seed greeting tone.",
  })
  .run(async (ctx) => {
    const topic = String(ctx.inputs.topic ?? "the world");
    const tone = String(ctx.inputs.tone ?? "warm");
    const seed = await ctx.stage("greet").prompt(`Write a short ${tone} greeting about "${topic}".`);
    const [formal, casual] = await Promise.all([
      ctx.stage("formal").prompt(`Rewrite this as a formal greeting:\n\n${seed}`),
      ctx.stage("casual").prompt(`Rewrite this as a casual greeting:\n\n${seed}`),
    ]);
    const merged = await ctx.stage("merge").prompt(
      `Combine these two greetings into a single message:\n\n## Formal\n${formal}\n\n## Casual\n${casual}`,
    );
    return { seed, formal, casual, merged };
  })
  .compile();

export const atomicExampleHeadlessFanout = defineWorkflow("atomic-example-headless-fanout")
  .description("Converted headless-test shape: visible seed, parallel analyses, merge, verdict.")
  .input("prompt", {
    type: "text",
    default: "TypeScript",
    description: "Topic to analyze.",
  })
  .run(async (ctx) => {
    const prompt = String(ctx.inputs.prompt ?? "TypeScript");
    const seed = await ctx.stage("seed").prompt(`In one short paragraph, describe what "${prompt}" is.`);
    const [pros, cons, uses] = await Promise.all([
      ctx.stage("pros").prompt(`Given this topic overview, list 3 pros:\n\n${seed}`),
      ctx.stage("cons").prompt(`Given this topic overview, list 3 cons:\n\n${seed}`),
      ctx.stage("uses").prompt(`Given this topic overview, list 3 use cases:\n\n${seed}`),
    ]);
    const summary = await ctx.stage("merge").prompt(
      `Combine these three analyses into a concise summary:\n\n## Pros\n${pros}\n\n## Cons\n${cons}\n\n## Uses\n${uses}`,
    );
    const verdict = await ctx.stage("verdict").prompt(
      `Given this summary, write a one-sentence final verdict:\n\n${summary}`,
    );
    return { seed, pros, cons, uses, summary, verdict };
  })
  .compile();

export const atomicExampleHilFavoriteColor = defineWorkflow("atomic-example-hil-favorite-color")
  .description("Converted HIL example: prompt the stage to ask for a favorite color, then describe it.")
  .run(async (ctx) => {
    const answer = await ctx.stage("ask-color", { tools: ["ask_user_question"] }).prompt(
      [
        "Use the ask_user_question tool exactly once to ask the user what their favorite color is.",
        "Ask one question with header Color and three options: Blue, Green, and Purple.",
        "After the user responds, summarize the selected color in one sentence.",
      ].join("\n"),
    );
    const description = await ctx.stage("describe-color").prompt(
      `Write a short evocative description of the color named in this prior answer:\n\n${answer}`,
    );
    return { answer, description };
  })
  .compile();

export const atomicExampleHilFavoriteColorHeadless = defineWorkflow(
  "atomic-example-hil-favorite-color-headless",
)
  .description("Converted HIL headless regression shape: do not wait forever for user input.")
  .run(async (ctx) => {
    const answer = await ctx.stage("ask-color-headless").prompt(
      [
        "You would normally ask: What is your favorite color?",
        "In this headless-style workflow, do not ask a follow-up question.",
        "Pick a plausible answer yourself and reply with one sentence.",
      ].join("\n"),
    );
    return { answer };
  })
  .compile();

export const atomicExampleStructuredOutput = defineWorkflow("atomic-example-structured-output")
  .description("Converted structured-output demo: request JSON and validate its basic shape.")
  .input("prompt", {
    type: "text",
    required: true,
    default: "Python",
    description: "Programming language to describe.",
  })
  .run(async (ctx) => {
    const language = String(ctx.inputs.prompt ?? "Python");
    const raw = await ctx.stage("describe").prompt(
      [
        `Return JSON facts about ${language}.`,
        'Use this exact shape: {"language":"...","primaryUse":"...","strengths":["..."]}',
        "Return only JSON.",
      ].join("\n"),
    );
    const facts = parseLanguageFacts(raw, language);
    if (facts.strengths.length === 0) {
      throw new Error("structured output did not contain any strengths");
    }
    return { facts };
  })
  .compile();

export const atomicExampleReviewFixLoop = defineWorkflow("atomic-example-review-fix-loop")
  .description("Converted review/fix loop with bounded iterations and early exit.")
  .input("topic", {
    type: "text",
    required: true,
    default: "adopting Bun at a small engineering team",
    description: "What the draft should argue.",
  })
  .input("max_iterations", {
    type: "number",
    default: 3,
    description: "Maximum number of review/fix rounds before giving up.",
  })
  .run(async (ctx) => {
    const topic = String(ctx.inputs.topic ?? "adopting Bun at a small engineering team");
    const maxIterations = Math.max(1, Number(ctx.inputs.max_iterations ?? 3));
    let draft = await ctx.stage("draft").prompt(
      `Write a two-paragraph argument for ${topic}. Be concrete and write prose, not a list.`,
    );
    let verdict: "clean" | "needs_fix" = "needs_fix";
    let iterations = 0;

    for (let i = 1; i <= maxIterations; i += 1) {
      iterations = i;
      const review = await ctx.stage(`review-${i}`).prompt(
        [
          "Review this draft.",
          'Reply with either "CLEAN" or "NEEDS_FIX: <one-sentence issue>".',
          "",
          draft,
        ].join("\n"),
      );
      const normalizedReview = review.toUpperCase();
      verdict = normalizedReview.includes("CLEAN") && !normalizedReview.includes("NEEDS_FIX")
        ? "clean"
        : "needs_fix";
      if (verdict === "clean" || i === maxIterations) break;
      draft = await ctx.stage(`fix-${i}`).prompt(
        `Revise this draft to address the review feedback.\n\nReview:\n${review}\n\nDraft:\n${draft}`,
      );
    }

    return { draft, verdict, iterations };
  })
  .compile();

export const atomicExampleReviewerToolTest = defineWorkflow("atomic-example-reviewer-tool-test")
  .description("Converted reviewer-tool-test shape: force a structured review verdict.")
  .run(async (ctx) => {
    const review = await ctx.stage("review").prompt(
      [
        "You are reviewing this one-line patch:",
        "",
        "```diff",
        "--- a/hello.ts",
        "+++ b/hello.ts",
        "@@ -1 +1 @@",
        '-export const greeting = "hi";',
        '+export const greeting = "hello";',
        "```",
        "",
        "Return JSON only with this exact shape:",
        '{"verdict":"patch is correct","explanation":"one sentence"}',
        'The verdict must be either "patch is correct" or "patch is incorrect".',
      ].join("\n"),
    );
    let verdict: string;
    let explanation: string;
    try {
      const parsed = JSON.parse(review) as { verdict?: unknown; explanation?: unknown };
      verdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
      explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
    } catch {
      throw new Error("reviewer-tool-test did not return JSON");
    }
    if (verdict !== "patch is correct" && verdict !== "patch is incorrect") {
      throw new Error("reviewer-tool-test returned an invalid verdict");
    }
    if (explanation.length === 0) {
      throw new Error("reviewer-tool-test returned an empty explanation");
    }
    return { verdict, explanation };
  })
  .compile();

export const atomicExamplePaneNavigation = defineWorkflow("atomic-example-pane-navigation")
  .description("Converted pane-navigation demo: three visible sequential stages.")
  .run(async (ctx) => {
    const alpha = await ctx.stage("alpha").prompt("Reply with a single line: alpha.");
    const bravo = await ctx.stage("bravo").prompt("Reply with a single line: bravo.");
    const charlie = await ctx.stage("charlie").prompt("Reply with a single line: charlie.");
    return { alpha, bravo, charlie };
  })
  .compile();

export const atomicExampleBackgroundSubagents = defineWorkflow(
  "atomic-example-background-subagents",
)
  .description("Converted background-subagents harness shape: dispatch instructions, then verify.")
  .run(async (ctx) => {
    const dispatch = await ctx.stage("dispatch").prompt(
      [
        "Pretend to dispatch three independent background subagents.",
        "Return immediately with the marker names bg-1, bg-2, and bg-3.",
      ].join("\n"),
    );
    const verify = await ctx.stage("verify").prompt(
      `Verify that this dispatch report mentions bg-1, bg-2, and bg-3:\n\n${dispatch}`,
    );
    return { dispatch, verify };
  })
  .compile();

export const atomicExampleEmptyFanout = defineWorkflow("atomic-example-empty-fanout")
  .description("Edge-case fixture: zero branch Promise.all still reaches the aggregator.")
  .input("branches", {
    type: "number",
    default: 0,
    description: "Number of branches to create.",
  })
  .run(async (ctx) => {
    const count = Math.max(0, Math.floor(Number(ctx.inputs.branches ?? 0)));
    const branches = await Promise.all(
      Array.from({ length: count }, (_item, index) =>
        ctx.stage(`branch-${index + 1}`).prompt(`Produce branch ${index + 1}.`),
      ),
    );
    const aggregate = await ctx.stage("aggregate").prompt(
      branches.length === 0
        ? "No branches ran. Confirm the empty fanout completed."
        : `Summarize these branch outputs:\n\n${branches.join("\n\n")}`,
    );
    return { branch_count: branches.length, aggregate };
  })
  .compile();
