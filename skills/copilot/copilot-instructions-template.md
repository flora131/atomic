# GitHub Copilot Instructions Template

This is a template for creating project-specific instructions for GitHub Copilot.

Place this file at `.github/copilot-instructions.md` in your repository root.

## Project-Specific Guidelines

[Describe your project's coding standards, patterns, and conventions]

## Tech Stack

[List your technologies, frameworks, and key libraries]

## Architecture

[Describe your project's architecture and key design patterns]

## Coding Standards

### Naming Conventions
- [Your naming conventions here]

### File Organization
- [Your file structure conventions]

### Testing
- [Your testing approach and requirements]

## Security Requirements

- [Project-specific security requirements]
- [Authentication/authorization patterns]

## Performance Considerations

- [Performance requirements and constraints]
- [Optimization priorities]

## Common Patterns

[Include common code patterns used in your project]

## What to Avoid

[List anti-patterns or deprecated approaches]

---

## Including Skills in Copilot Instructions

You can reference skills from this repository in your `.github/copilot-instructions.md`:

```markdown
# Project Copilot Instructions

## Development Workflow

Follow TDD for all feature development:

[Copy content from skills/copilot/workflow-tdd.md]

## Security Requirements

Apply security best practices:

[Copy content from skills/copilot/domain-security.md]

## API Design

When creating APIs, follow REST principles:

[Copy content from skills/copilot/architecture-api-design.md]
```

## Example: Complete Copilot Instructions

```markdown
# MyProject Copilot Instructions

## Tech Stack
- Frontend: React 18, TypeScript, TailwindCSS
- Backend: Node.js, Express, PostgreSQL
- Testing: Jest, React Testing Library

## Test-Driven Development

When implementing features:

1. Write the test BEFORE implementation
2. Run the test to verify it FAILS
3. Write simplest code to pass the test
4. Refactor while keeping tests green

## API Conventions

- Use `/api/v1/` prefix for all endpoints
- Plural nouns for resources: `/api/v1/users`
- Standard HTTP methods and status codes
- Consistent error format with code and message

## Security

- All endpoints require authentication except `/api/v1/auth/*`
- Use parameterized queries for all database access
- Validate all input on server-side
- Never log sensitive data (passwords, tokens, PII)

## Code Style

- Components: PascalCase (UserProfile.tsx)
- Functions: camelCase (getUserProfile)
- Constants: UPPER_SNAKE_CASE (MAX_RETRIES)
- Use absolute imports: `@/components/Button`

## Testing

- Minimum 80% code coverage
- Test file naming: `ComponentName.test.tsx`
- Use data-testid for test selectors
- Mock external API calls

## Performance

- Lazy load route components
- Virtualize lists > 100 items
- Implement pagination for API responses
- Use React.memo for expensive components
```
