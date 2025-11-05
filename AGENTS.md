# Guidelines for Development

# Skills Protocol

**IMPORTANT:** Before responding to ANY user message, you MUST check for relevant skills and use them. See [SKILLS.md](SKILLS.md) for the complete mandatory first response protocol and usage guidelines.

**Key points:**
- If a skill exists for your task, you MUST use it
- List available skills, check for matches, then proceed
- Announce which skill you're using
- See SKILLS.md for detailed instructions and common pitfalls to avoid

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `specs/PLANS.md`) from design to implementation. If the user request requires multiple specs, create multiple specification files in the `specs/` directory. After creating the specs, create a master ExecPlan that links to each individual spec ExecPlan. Update the `specs/README.md` to include links to the new specs.

ALWAYS start an ExecPlan creation by consulting the DeepWiki tool for best practices on design patterns, architecture, and implementation strategies. Ask it questions about the system design and constructs in the library that will help you achieve your goals.

Skip using an ExecPlan for straightforward tasks (roughly the easiest 25%).

## Smart Scope Selection

Based off of the user request you need to determine the appropriate scope of the system for the spec.

1. **Frontend Only**: If the request only involves user interface changes, visual elements, or client-side logic, target the frontend component.
2. **Backend Only**: If the request involves data processing, business logic, database interactions, or server-side functionality, target the backend component.
3. **Both Frontend and Backend**: If the request involves changes that affect both the user interface and server-side logic, you will need to make coordinated changes in both the frontend and backend components.

## Skills

For complete skills usage guidelines, see [SKILLS.md](SKILLS.md).
