# Guidelines for Development

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `specs/PLANS.md`) from design to implementation. If the user request requires multiple specs, create multiple specification files in the `specs/` directory. After creating the specs, create a master ExecPlan that links to each individual spec ExecPlan. Update the `specs/README.md` to include links to the new specs.

Skip using an ExecPlan for straightforward tasks (roughly the easiest 25%).

## Smart Scope Selection

Based off of the user request you need to determine the appropriate scope of the system for the spec.

1. **Frontend Only**: If the request only involves user interface changes, visual elements, or client-side logic, target the frontend component.
2. **Backend Only**: If the request involves data processing, business logic, database interactions, or server-side functionality, target the backend component.
3. **Both Frontend and Backend**: If the request involves changes that affect both the user interface and server-side logic, you will need to make coordinated changes in both the frontend and backend components.