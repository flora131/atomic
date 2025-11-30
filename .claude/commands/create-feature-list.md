---
description: Create a detailed `feature-list.json` and `progress.txt` for implementing features or refactors in a codebase from a spec.
model: sonnet
allowed-tools: Edit, Read, Write, Bash
argument-hint: [spec-path]
---

You are tasked with creating a detailed `feature-list.json` file and `progress.txt` for implementing features or refactors in a codebase based on a provided specification.

# Tasks

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
