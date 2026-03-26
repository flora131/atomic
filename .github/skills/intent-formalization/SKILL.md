---
name: intent-formalization
description: >
  Formalize and clarify user intent before executing complex, ambiguous, or high-risk agent tasks.
  Use this skill whenever the user's request is underspecified, has multiple plausible interpretations,
  involves multi-step workflows with branching outcomes, or carries risk of irreversible side effects
  (file mutations, API calls, deployments, refactors across many files). Also trigger when the user
  asks for help designing intent clarification flows for their own agents or multi-agent systems —
  e.g., "how should my agent clarify intent", "intent formalization for agents", "disambiguation in
  agentic workflows", or "structured planning before execution". If the user says something vague
  like "clean this up" or "fix the tests" and context alone is insufficient to resolve the ambiguity,
  use this skill to formalize their intent before acting.
---

# Intent Formalization

This skill provides a structured framework for resolving ambiguity in user requests before an agent
commits to execution. The core insight: agents fail far more often from executing the *wrong plan*
than from executing a correct plan poorly. Investing a small amount of effort upfront to formalize
intent dramatically reduces wasted work, harmful side effects, and user frustration.

**The meta-principle: clarification should reduce user effort, not increase it.** The best intent
formalization is invisible — the agent just does the right thing because it has enough context.
The second best is a quick confirmation of a specific plan. The worst is an open-ended "can you
clarify?" Every question you ask the user is an admission that the system failed to understand.
The techniques below are ordered from least to most user effort for this reason — exhaust the
cheaper options before escalating.

## The Specification Artifact Spectrum

Intent formalization produces artifacts along a spectrum of increasing expressiveness. Choose the
lightest artifact that provides sufficient assurance for the task:

- **Tests** (input/output examples): Concrete behavioral expectations. "Given [1,2,3,2,4], return
  [1,3,4]." Cheapest to produce, easiest for users to validate, and immediately executable.
- **Code contracts** (assertions, pre/post conditions): Executable specifications checked at
  runtime. `assert all(nums.count(x) == 1 for x in result)`. Language-agnostic, deployable now.
- **Logical contracts**: Specifications in verification-aware languages (Dafny, F*, Verus) using
  quantifiers, ghost variables, and recursive predicates. Checked statically by SMT solvers.
- **Domain-specific languages**: Complete formal specs from which correct code is synthesized
  automatically via verified compilation.

These levels are complementary, not alternatives. Tests can validate postconditions, postconditions
can guide invariant discovery, and invariants can anchor full proofs. Progress at any level enables
progress at the others.

The interaction ladder below determines *how* you engage the user to formalize intent. The artifact
spectrum determines *what form* that formalization takes. Use both axes together.

## When to Formalize

Not every request needs formalization. Use the **ambiguity / risk matrix** to decide:

|                      | Low Risk                          | High Risk                              |
| -------------------- | --------------------------------- | -------------------------------------- |
| **Clear intent**     | Execute directly                  | Emit a plan summary, then execute      |
| **Ambiguous intent** | Contrastive clarification (quick) | Full intent formalization (structured) |

Signals that intent is **ambiguous**:
- The request uses vague verbs: "clean up", "fix", "improve", "handle", "deal with"
- Multiple plausible interpretations exist and they lead to materially different outcomes
- The scope is underspecified: which files? which module? which definition of "better"?
- The user's words conflict with the surrounding context (e.g., they say "delete" but the context
  suggests they mean "archive")

Signals that the action is **high risk**:
- Mutations to many files or production systems
- Irreversible operations (deletes, deployments, public API changes)
- Actions that touch shared state (databases, config, CI pipelines)
- Long-running workflows where mid-course correction is expensive

## The Intent Formalization Ladder

Use the lightest technique that resolves the ambiguity. Escalate only when the lighter approach
is insufficient. Think of these as rungs on a ladder — start at the bottom, climb only as needed.

### Rung 1: Implicit Formalization (Zero User Effort)

Before asking the user anything, try to resolve the ambiguity yourself using available context.
This is where the agent earns its keep — the more context it can leverage, the fewer questions
it needs to ask.

#### Building a World Model

The agent should maintain a mental model of the current state of the project and use **abductive
reasoning** — inferring the most likely intent given the user's words *plus* the surrounding
context. The richer the world model, the more ambiguity can be resolved without asking.

Sources to ground your interpretation (check all that are available):

1. **Recent changes.** If the user just renamed a function and says "fix the tests", the most
   likely intent is "update test call sites to match the rename" — not "rewrite failing test logic."
   Git diffs, recent file modifications, and conversation history are the strongest signal.

2. **Code structure.** Use the project's dependency graph, module boundaries, and call sites to
   understand scope. If the user says "refactor the auth module", the imports and call graph tell
   you which files are in-scope and which callers might break. Tools like AST analysis, code
   property graphs (CPGs), and semantic search can surface structural context that plain text
   search would miss.

3. **Conventions and patterns.** Look at existing code style, naming patterns, test patterns, and
   error handling idioms. If the codebase uses Result types for error handling, "improve error
   handling" probably means "convert throws to Result types" — not "add try/catch blocks." The
   codebase itself is a specification of the team's preferences.

4. **Project artifacts.** READMEs, ADRs, CI configs, and issue trackers carry intent signal.
   A linked GitHub issue often disambiguates a terse request completely.

#### Abductive Inference

With context assembled, apply abductive reasoning: "What is the simplest explanation of the
user's request that is consistent with everything I know about the current state?"

- **Apply the Principle of Least Surprise.** When two interpretations are equally plausible,
  prefer the one that makes fewer changes, touches fewer files, and is easier to undo.
- **Prefer the interpretation that matches the most recent context.** A request immediately
  following a refactor is almost certainly about that refactor.
- **Prefer the interpretation consistent with project conventions** over one that introduces
  a new pattern.

If implicit formalization gives you >90% confidence in a single interpretation, emit a brief
**plan summary** and proceed (see Rung 2). If not, escalate to Rung 3.

### Rung 2: Plan Summary (Minimal User Effort)

Emit a structured summary of what you intend to do. This is not a question — it's a statement
that the user can interrupt if it's wrong. The format:

```
I'll [action] by [method]. This will touch [scope] and the result will be [expected outcome].
```

**Example:**
> I'll update the test call sites to use the renamed `authenticateUser` function. This touches
> 3 test files in `tests/auth/` and the result will be all auth tests passing again.

Keep it to 1-3 sentences. The user can read it in under 5 seconds and either let you proceed
or course-correct. This works well for clear-intent + high-risk situations.

### Rung 3: Contrastive Clarification (Low User Effort)

Present 2-3 *contrasting interpretations* and let the user pick. This is the workhorse technique
for ambiguous requests. The key design principles:

- **Present interpretations, not questions.** "Did you mean A or B?" is better than "Can you
  clarify what you meant?" Users are much better at *recognizing* their intent than *specifying*
  it from scratch.
- **Make the differences concrete and consequential.** Each option should lead to a materially
  different outcome. If two options differ only in minor details, merge them.
- **Include scope and impact.** Each option should say what it touches and what changes.
- **Limit to 2-3 options.** More than 3 creates decision fatigue. If there are truly many
  possibilities, group them into families first.

**Example:**

> I see a couple of ways to approach "clean up the error handling":
>
> **(A) Standardize on Result types** — Convert all `throw` statements in `src/auth/` to return
> `Result<T, AuthError>`. Touches 6 files, changes function signatures.
>
> **(B) Add error boundaries at the API layer** — Keep internal throws but catch everything at
> the controller level. Touches 2 files, no signature changes.
>
> Which direction?

#### Test-Driven Disambiguation (TiCoder Pattern)

For code-generation tasks, a more powerful variant: instead of presenting prose interpretations,
generate multiple candidate implementations, find *inputs where they disagree*, and present those
as concrete yes/no test cases.

This works because the disagreement points between plausible implementations are exactly the
ambiguity points in the user's intent. The user validates a few tests rather than reasoning about
abstract interpretations.

**Example:**

> Prompt: "Find the shared elements from two lists."
>
> I generated a few candidate implementations and they disagree on edge cases.
> Can you tell me the expected output for these inputs?
>
> 1. `common([1,2,3], [2,3,4])` → `[2,3]`? **Yes / No**
> 2. `common([1,2,2], [2,2,3])` → `[2,2]`? **Yes / No**
>
> (If you reject #2, that tells me the result should be a set, not a multiset.)

This approach is especially valuable because approved tests become regression tests — the intent
formalization persists as an executable artifact, not just a conversation record. Prioritize
generating tests at **points of maximum disagreement** between candidates — these are the inputs
most likely to reveal where the LLM's default interpretation diverges from the user's actual intent.

### Rung 4: Structured Intent Schema (Moderate User Effort)

For complex, multi-step, or high-stakes tasks, emit a full structured intent object and ask the
user to validate it. This is the "flight plan" approach — detailed enough that the user can
catch misunderstandings before execution begins.

```yaml
Goal: Refactor error handling in the auth module
Scope:
  in_bounds:
    - src/auth/**
    - tests/auth/**
  out_of_bounds:
    - src/auth/legacy/** (do not touch)
    - public API signatures
Approach: Convert throw statements to typed Result<T, AuthError> returns
Constraints:
  - Do not change any public-facing function signatures
  - Preserve existing error messages (users see them)
  - All existing tests must still pass
Expected outcome: Auth module uses Result types internally; no external behavior change
Risk level: Medium (touches 6 files, but changes are mechanical and testable)
Rollback: Git revert on the single commit
```

Present this as a reviewable artifact the user can edit, annotate, or approve. The structured
format forces disambiguation — the agent can't hide behind vague language.

### Rung 5: Formal Pre/Post Conditions (High User Effort, High Assurance)

For safety-critical or formally verifiable work, generate lightweight formal specifications that
capture the user's intent as machine-checkable constraints:

```
requires: input is List<T> where T: Ord
ensures:
  - output.is_sorted()
  - output.to_set() == input.to_set()
  - output.len() == input.to_set().len()
```

The user doesn't write the spec — the agent proposes it, and the user validates. This is most
useful when the work product can actually be verified against the spec (sorting algorithms,
data transformations, API contracts, database migrations).

Think of this as: the agent translates the user's informal English into a formal contract, and
the user says "yes, that's what I meant." The contract then becomes a test oracle.

#### Validating Generated Specifications

There is no oracle for specification correctness other than the user — but you can catch many
spec errors automatically before presenting them. Evaluate generated specs against two properties:

- **Soundness**: The spec does not reject valid implementations. Check by running it against
  known-good test inputs. If it fails on a correct input, the spec is overly restrictive.
- **Completeness**: The spec rejects incorrect implementations. Check by *mutating* correct
  outputs (swap elements, drop items, change values) and verifying the spec catches the mutation.
  If mutated outputs pass the spec, it's too permissive.

**Common spec completeness trap:** One-directional implications where bi-implications are needed.
For example, `ensures forall x :: x in result ==> (inA(x) && inB(x))` is *sound* but incomplete —
the empty list trivially satisfies it. The fix: `<==>` instead of `==>`.

When generating specs, always self-check: "Does the trivial output (empty list, zero, null) satisfy
this spec? If so, the spec is likely incomplete."

## Progressive Disclosure: Execution as Clarification

Sometimes the best way to formalize intent is to *not* formalize everything upfront. Instead,
execute in small, reviewable increments where each checkpoint implicitly narrows the intent space
through the user's accept/reject decisions.

This is distinct from the ladder above. The ladder asks "how do I clarify intent *before*
execution?" Progressive disclosure asks "how do I clarify intent *through* execution?"

### How It Works

Break the task into small, independently reviewable steps. After each step, present the result
and let the user's reaction (approve, adjust, or reject) inform the next step. Each checkpoint
is a **decision point that narrows the intent space** — not just a progress report.

**Example: Refactoring a module**

Rather than asking the user to approve a full refactoring plan upfront:

1. **Step 1:** Extract the three helper functions first. Show the diff. User approves.
   → This confirms the user wants structural decomposition, not just renaming.
2. **Step 2:** Convert error handling in the extracted functions. Show the diff. User says
   "actually, keep the try/catch pattern in `parseConfig`."
   → This narrows intent: the user wants selective modernization, not uniform conversion.
3. **Step 3:** Update tests. The user's step-2 feedback informs what the tests should expect.

Each step produces a reviewable, revertible artifact. The user's feedback at each checkpoint
is itself a form of intent formalization — you're building the specification incrementally
through the user's reactions to concrete changes.

### When to Use Progressive Disclosure vs. Upfront Formalization

Use progressive disclosure when:
- The task is exploratory and the user may not know exactly what they want until they see it
- The work is easily decomposable into independent, revertible steps
- The cost of a wrong step is low (easy to undo via git revert or similar)
- The user's vocabulary for describing what they want is imprecise, but they'll recognize it
  when they see it

Use upfront formalization (the ladder) when:
- Steps are interdependent and early mistakes cascade
- Individual steps are expensive or irreversible
- The user has a clear goal but hasn't articulated the constraints
- You're delegating to other agents who can't interactively check in

The two approaches combine naturally: use upfront formalization (Rung 3-4) to establish the
high-level direction, then use progressive disclosure for the execution details within each
phase.

## Patterns for Multi-Agent Systems

When the "user" is another agent in a multi-agent workflow, the dynamics change. Agents can't
recognize intent the way humans can, so formalization needs to be more explicit.

### Intent Passing Protocol

When delegating work between agents, the delegating agent should pass a structured intent object
(Rung 4 schema) rather than a natural language prompt. This prevents intent drift across
delegation hops — each agent in the chain sees the same formal intent, not a game-of-telephone
rephrasing.

```
Supervisor → Worker:
{
  "intent": { ... structured schema ... },
  "delegation_context": "Why this subtask exists in the broader plan",
  "success_criteria": ["Concrete, verifiable conditions"],
  "constraints": ["What NOT to do"],
  "escalation_policy": "Return to supervisor if ambiguity exceeds threshold"
}
```

### Ambiguity Budgets

Assign each agent an **ambiguity budget** — the maximum number of unresolved questions it can
carry before it must either escalate or clarify. This prevents agents from charging ahead with
optimistic assumptions and producing work that needs to be thrown away.

- **Leaf agents** (doing the actual work): low budget (0-1 unresolved questions)
- **Coordinator agents** (planning and delegating): moderate budget (2-3)
- **Supervisor agents** (overseeing the workflow): high budget (can carry ambiguity while
  gathering information to resolve it)

### Intent Decomposition Trees

For complex goals, model the intent as a DAG:
- **Root**: The user's high-level goal
- **Internal nodes**: Sub-intents that decompose the goal
- **Leaves**: Atomic, executable actions
- **Edges**: Dependencies and ordering constraints

Each node should have its own mini-schema (goal, scope, constraints, success criteria). This
makes it possible to delegate subtrees to different agents while preserving the overall intent
structure. The tree also serves as an audit trail — you can trace any action back to the
high-level intent that motivated it.

## Formalizing Change Intent

Most real-world development involves *changing* existing code, not writing from scratch. Change
intent is fundamentally different from green-field intent — it must capture both what should change
AND what must stay the same.

### The Change Intent Schema

When formalizing intent for modifications, the structured schema (Rung 4) should include:

```yaml
Goal: Add caching to the user lookup endpoint
Change boundary:
  must_change:
    - "GET /users/:id handler should check cache before DB"
    - "Cache invalidation on user update"
  must_preserve:
    - "All existing API response shapes remain identical"
    - "Error handling behavior unchanged"
    - "Auth middleware still runs on every request"
Behavioral delta:
  before: "Every GET /users/:id hits the database"
  after: "GET /users/:id returns cached result when available, falls back to DB"
Regression signals:
  - "Existing integration tests still pass"
  - "Response body schema unchanged (verify with snapshot tests)"
```

The `must_preserve` section is critical. Without it, an agent might "add caching" by restructuring
the entire endpoint — technically correct but violating the implicit expectation that everything
else stays the same.

### Change Intent for Code Translation

A related pattern: migrating code between languages (e.g., C to Rust, Python 2 to 3). Here,
generating intermediate specifications from the source code and using them to guide the translation
significantly improves correctness. The spec serves as a language-independent contract that both
the original and translated code should satisfy.

## Anti-Patterns to Avoid

**Over-clarification.** Don't ask 5 questions when 1 would suffice. Don't formalize simple
requests. "Add a docstring to this function" doesn't need a flight plan. The goal is to reduce
user effort, not increase it.

**Open-ended questions.** "Can you clarify what you mean?" puts the entire cognitive burden back
on the user. Always propose specific interpretations (contrastive clarification) rather than
asking the user to re-explain from scratch.

**False precision.** Don't generate formal specs for tasks that are inherently subjective.
"Make the UI look better" cannot be meaningfully formalized into pre/post conditions. Use
contrastive clarification instead ("Do you mean A or B?").

**Intent drift in loops.** In iterative workflows, re-validate the original intent periodically.
After 3 rounds of "actually, change this instead", the current execution may have drifted far
from what the user originally wanted. Pause and re-emit a plan summary.

**Confirmation fatigue.** If you ask for confirmation on every single step, the user will start
rubber-stamping "yes" without reading. Reserve explicit confirmation for genuine decision points
— moments where the user's choice leads to meaningfully different outcomes.

**Untargeted clarification.** Not all ambiguities are equally likely to cause bugs. Prioritize
clarification at **points of maximum divergence** — places where different plausible implementations
would produce different outputs. A request might have 5 ambiguous aspects, but only 1-2 where the
wrong interpretation leads to a bug. Focus on those. The cost of a clarification question should
be weighed against the bug-prevention value of the answer.

## Layering Strategy: Building Toward Invisible Formalization

The techniques above should be layered, not chosen in isolation. A recommended baseline:

1. **Always** emit a plan summary (Rung 2) for any non-trivial task. This is cheap insurance.
2. **When ambiguous**, use contrastive clarification or test-driven disambiguation (Rung 3).
   Never ask open-ended questions.
3. **For high-risk actions**, generate lightweight pre/post conditions as a "contract" the user
   signs off on. Self-check for completeness before presenting.
4. **Over time, invest in the world model** (Rung 1). The more context the agent can leverage —
   code structure, project conventions, recent changes, historical decisions — the more ambiguity
   it resolves without asking. Every clarification question the user answers is data that should
   improve future inference. Track which types of requests required clarification and what the
   resolution was — this builds a project-specific model of intent patterns.

The goal is a virtuous cycle: each interaction teaches the agent something about how this user
and this codebase work, so the next interaction requires less clarification. The best agent is
one that rarely needs to ask because it has built a rich enough world model to infer correctly.

## Quick Reference: Decision Flowchart

```
User request arrives
  │
  ├─ Is this a change to existing code?
  │   └─ Yes → Include must_preserve constraints in any formalization
  │
  ├─ Can the world model resolve intent? (recent changes, code structure, conventions)
  │   ├─ Yes + Low risk  → Execute directly
  │   └─ Yes + High risk → Rung 2: Plan summary, then execute
  │
  ├─ Is the task exploratory / easily decomposable / cheap to undo?
  │   └─ Yes → Progressive disclosure: execute in small steps, let feedback narrow intent
  │
  └─ Intent is ambiguous
      ├─ Code generation task?
      │   └─ Yes → Rung 3 + TiCoder: Generate candidates, find disagreements, present tests
      ├─ 2-3 plausible interpretations     → Rung 3: Contrastive clarification
      ├─ Complex multi-step task           → Rung 4: Structured intent schema
      └─ Safety-critical / verifiable      → Rung 5: Formal pre/post conditions
                                              (self-check: does trivial output satisfy the spec?)
```

When in doubt, default to Rung 3 (contrastive clarification). It's the best ratio of
disambiguation power to user effort. For code-generation tasks specifically, prefer the
test-driven disambiguation variant — it produces executable artifacts, not just conversation.
For exploratory work, consider progressive disclosure — sometimes the user needs to *see*
a concrete step before they can articulate what they actually want.