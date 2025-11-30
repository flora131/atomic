---
description: Create a detailed execution plan for implementing features or refactors by leveraging existing research.
agent: build
model: anthropic/claude-opus-4-5
---

# Create Technical Specification

You are tasked with creating a spec for implementing a new feature or system change in the codebase by leveraging existing research in the `research/` directory. Follow the template below to produce a comprehensive specification using the findings from RELEVANT research documents.

## Current Repository State

- Current date/time: !`date "+%Y-%m-%d %H:%M:%S %Z"`
- Git branch: !`git branch --show-current`
- Git commit: !`git rev-parse --short HEAD`
- Recent commits: !`git log --oneline -5`

# Technical Design Document / RFC Template

| Document Metadata      | Details                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| Author(s)              | !`git config user.name`                                                        |
| Status                 | Draft (WIP) / In Review (RFC) / Approved / Implemented / Deprecated / Rejected |
| Team / Owner           |                                                                                |
| Created / Last Updated |                                                                                |

## 1. Executive Summary

*Instruction: A "TL;DR" of the document. Assume the reader is a VP or an engineer from another team who has 2 minutes. Summarize the Context (Problem), the Solution (Proposal), and the Impact (Value). Keep it under 200 words.*

## 2. Context and Motivation

*Instruction: Why are we doing this? Why now? Link to the Product Requirement Document (PRD).*

### 2.1 Current State

*Instruction: Describe the existing architecture. Use a "Context Diagram" if possible. Be honest about the flaws.*

### 2.2 The Problem

*Instruction: What is the specific pain point?*

- **User Impact:**
- **Business Impact:**
- **Technical Debt:**

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Goal 1
- [ ] Goal 2

### 3.2 Non-Goals (Out of Scope)

*Instruction: Explicitly state what you are NOT doing. This prevents scope creep.*

- [ ] Non-goal 1
- [ ] Non-goal 2

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

*Instruction: Insert a C4 System Context or Container diagram. Show the "Black Boxes."*

### 4.2 Architectural Pattern

*Instruction: Name the pattern (e.g., "Event Sourcing", "BFF - Backend for Frontend").*

### 4.3 Key Components

| Component | Responsibility | Technology Stack | Justification |
| --------- | -------------- | ---------------- | ------------- |
|           |                |                  |               |

## 5. Detailed Design

### 5.1 API Interfaces

*Instruction: Define the contract. Use OpenAPI/Swagger snippets or Protocol Buffer definitions.*

### 5.2 Data Model / Schema

*Instruction: Provide ERDs or JSON schemas. Discuss normalization vs. denormalization.*

### 5.3 Algorithms and State Management

*Instruction: Describe complex logic, state machines, or consistency models.*

## 6. Alternatives Considered

| Option | Pros | Cons | Reason for Rejection |
| ------ | ---- | ---- | -------------------- |
|        |      |      |                      |

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- **Authentication:**
- **Authorization:**
- **Data Protection:**

### 7.2 Observability Strategy

- **Metrics:**
- **Tracing:**
- **Alerting:**

### 7.3 Scalability and Capacity Planning

- **Traffic Estimates:**
- **Storage Growth:**
- **Bottleneck:**

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] Phase 1:
- [ ] Phase 2:
- [ ] Phase 3:

### 8.2 Data Migration Plan

- **Backfill:**
- **Verification:**

### 8.3 Test Plan

- **Unit Tests:**
- **Integration Tests:**
- **End-to-End Tests:**

## 9. Open Questions / Unresolved Issues

*Instruction: List known unknowns. These must be resolved before the doc is marked "Approved".*

- [ ] Question 1
- [ ] Question 2
