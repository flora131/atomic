---
agent: 'agent'
model: 'Claude Sonnet 4.5'
tools: ['githubRepo', 'search/codebase', 'editFiles']
description: Create a detailed `feature-list.json` and `progress.txt` for implementing features or refactors in a codebase from a spec.
argument-hint: [feature-specification-path]

---

# Create Feature List

You are tasked with creating a detailed `feature-list.json` file and `progress.txt` for implementing features or refactors in a codebase based on a provided specification.

## Tasks

1. If a `progress.txt` file already exists in the repository root, remove it.
2. Create an empty `progress.txt` file to log your development progress.
3. Read the feature specification document located at **$ARGUMENTS** and follow the guidelines below to create the `feature-list.json` file.

## Create a `feature-list.json`

- If the file already exists, read its contents first to avoid duplications, and append new features as needed.
- Parse the feature specification document and create a structured JSON list of features to be implemented in order of highest to lowest priority.
- Use the following JSON structure for each feature in the list:

```json
{
    "category": "functional",
    "description": "New chat button creates a fresh conversation",
    "steps": [
      "Navigate to main interface",
      "Click the 'New Chat' button",
      "Verify a new conversation is created",
      "Check that chat area shows welcome state",
      "Verify conversation appears in sidebar"
    ],
    "passes": false
}
```

Where:
- `category`: Type of feature (e.g., "functional", "performance", "ui", "refactor").
- `description`: A concise description of the feature.
- `steps`: A list of step-by-step instructions to implement or test the feature.
- `passes`: A boolean indicating if the feature is currently passing tests (default to `false` for new features).

## Feature Categories

### Functional
Features that add new functionality or capabilities to the application.

### Performance
Features focused on improving speed, efficiency, or resource usage.

### UI
Features related to user interface improvements, styling, or user experience.

### Refactor
Changes that improve code structure without changing external behavior.

### Bug Fix
Fixes for existing issues or defects in the application.

### Testing
Addition or improvement of test coverage.

### Documentation
Updates to documentation, comments, or README files.

## Priority Guidelines

1. **Critical**: Security fixes, breaking bugs, blocking issues
2. **High**: Core functionality, user-facing features
3. **Medium**: Improvements, non-critical features
4. **Low**: Nice-to-have, polish, technical debt

## Output Format

The `feature-list.json` should contain an array of feature objects:

```json
[
  {
    "category": "functional",
    "description": "Feature 1 description",
    "steps": ["Step 1", "Step 2"],
    "passes": false
  },
  {
    "category": "ui",
    "description": "Feature 2 description",
    "steps": ["Step 1", "Step 2", "Step 3"],
    "passes": false
  }
]
```

## Important Notes

- Ensure features are atomic and testable
- Each feature should be independent when possible
- Steps should be clear and actionable
- Consider dependencies between features when ordering
- Update `progress.txt` with creation timestamp and summary
