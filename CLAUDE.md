# Guidelines for Development

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `specs/PLANS.md`) from design to implementation. If the user request requires multiple specs, create multiple specification files in the `specs/` directory. After creating the specs, create a master ExecPlan that links to each individual spec ExecPlan. Update the `specs/README.md` to include links to the new specs.

ALWAYS start an ExecPlan creation by consulting the DeepWiki tool for best practices on design patterns, architecture, and implementation strategies. Ask it questions about the system design and constructs in the library that will help you achieve your goals.

Skip using an ExecPlan for straightforward tasks (roughly the easiest 25%).

## ExecPlans Workflow with Superpowers Skills

When executing the ExecPlans methodology, use the following superpowers skills at each workflow phase:

1. **Initial Design Phase**
   - Use the `superpowers:brainstorming` skill to refine rough ideas into fully-formed designs before creating the ExecPlan

2. **ExecPlan Creation Phase**
   - ALWAYS consult the DeepWiki tool for best practices on design patterns and architecture
   - Use the `superpowers:writing-plans` skill to create comprehensive, self-contained ExecPlans

3. **Workspace Setup Phase** (for complex features)
   - Use the `superpowers:using-git-worktrees` skill to set up isolated development environments

4. **Implementation Phase**
   - Use the `superpowers:test-driven-development` skill for implementing features
   - Use the `superpowers:systematic-debugging` skill when encountering unexpected issues
   - Use the `superpowers:root-cause-tracing` skill for bugs deep in execution
   - Use the `superpowers:defense-in-depth` skill when validation is needed at multiple system layers

5. **Validation Phase**
   - Use the `superpowers:verification-before-completion` skill before marking any milestone complete

6. **Review Phase**
   - Use the `superpowers:requesting-code-review` skill after completing the ExecPlan

7. **Completion Phase**
   - Use the `superpowers:finishing-a-development-branch` skill to handle merge/PR/cleanup

**Additional Skills for Specific Scenarios:**
- `superpowers:executing-plans` - When you have a complete plan to execute in controlled batches
- `superpowers:subagent-driven-development` - For ExecPlans with independent parallel tasks

## Smart Scope Selection

Based off of the user request you need to determine the appropriate scope of the system for the spec.

1. **Frontend Only**: If the request only involves user interface changes, visual elements, or client-side logic, target the frontend component.
2. **Backend Only**: If the request involves data processing, business logic, database interactions, or server-side functionality, target the backend component.
3. **Both Frontend and Backend**: If the request involves changes that affect both the user interface and server-side logic, you will need to make coordinated changes in both the frontend and backend components.