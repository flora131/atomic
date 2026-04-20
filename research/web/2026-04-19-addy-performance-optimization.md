---
source_url: https://raw.githubusercontent.com/addyosmani/agent-skills/44dac80216da709913fb410f632a65547866346f/skills/performance-optimization/SKILL.md
fetched_at: 2026-04-19
fetch_method: markdown-accept-header
topic: Performance Optimization skill from addyosmani/agent-skills
---

# performance-optimization SKILL.md (verbatim)

---
name: performance-optimization
description: Optimizes application performance. Use when performance requirements exist, when you suspect performance regressions, or when Core Web Vitals or load times need improvement. Use when profiling reveals bottlenecks that need fixing.
---

## When to Use
- Performance requirements exist in spec (load time budgets, response time SLAs)
- Users or monitoring report slow behavior
- Core Web Vitals scores below thresholds
- Suspected change introduced a regression
- Building features that handle large datasets or high traffic
- NOT for: Optimizing before evidence of a problem exists (premature optimization)

## Core Web Vitals Targets
| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP | <= 2.5s | <= 4.0s | > 4.0s |
| INP | <= 200ms | <= 500ms | > 500ms |
| CLS | <= 0.1 | <= 0.25 | > 0.25 |

## Step-by-Step Process (Optimization Workflow)
1. MEASURE — Establish baseline with real data (Lighthouse/DevTools synthetic + web-vitals RUM)
2. IDENTIFY — Find actual bottleneck using symptom-to-cause decision tree
3. FIX — Address specific bottleneck (N+1 queries, unbounded fetching, image optimization, unnecessary re-renders, bundle size, missing caching)
4. VERIFY — Measure again, confirm improvement with before/after numbers
5. GUARD — Add monitoring or tests to prevent regression

## Common Anti-Patterns Fixed
- N+1 queries → single query with join/include
- Unbounded data fetching → pagination with take/skip
- Missing image optimization → responsive picture element with avif/webp, explicit dimensions, fetchpriority="high" for LCP, loading="lazy" for below-fold
- Unnecessary React re-renders → stable object references, React.memo, useMemo
- Large bundle size → dynamic import() + lazy(), route-level code splitting with Suspense
- Missing backend caching → TTL-based cache, HTTP Cache-Control headers

## Artifacts Produced
- Before/after measurement records (specific numbers required — not "feels faster")
- Lighthouse scores / trace files
- Bundle size comparison
- Performance budget pass/fail in CI

## Human-in-the-Loop / Developer Approval Gates
- No explicit HIL gate, but: "Optimize only what measurements prove matters."
- Any optimization without before/after profiling data is flagged as a red flag and should be rejected in code review.
- Performance budget enforcement in CI acts as an automated gate.

## Exit Criteria / Verification Checklist
- [ ] Before and after measurements exist (specific numbers)
- [ ] Specific bottleneck identified and addressed
- [ ] Core Web Vitals within "Good" thresholds
- [ ] Bundle size hasn't increased significantly
- [ ] No N+1 queries in new data fetching code
- [ ] Performance budget passes in CI (if configured)
- [ ] Existing tests still pass

## Cross-References / Supporting Files
- `references/performance-checklist.md` (detailed checklists, optimization commands, anti-pattern reference)
- Cross-references `browser-testing-with-devtools` (Chrome DevTools MCP for performance tracing)
- No additional files in this skill directory (SKILL.md only).
