---
name: prompt-engineer
description: Skill: Create, improve, or optimize prompts for Claude using best practices
aliases: [prompt]
argument-hint: "<prompt-description>"
required-arguments: [prompt-description]
---
# Prompt Engineering Skill

This skill provides comprehensive guidance for creating effective prompts for Claude based on Anthropic's official best practices. Use this skill whenever working on prompt design, optimization, or troubleshooting.

User request: $ARGUMENTS

## Overview

Apply proven prompt engineering techniques to create high-quality, reliable prompts that produce consistent, accurate outputs while minimizing hallucinations and implementing appropriate security measures.

## When to Use This Skill

Trigger this skill when users request:
- Help writing a prompt for a specific task
- Improving an existing prompt that isn't performing well
- Making Claude more consistent, accurate, or secure
- Creating system prompts for specialized roles
- Implementing specific techniques (chain-of-thought, multishot, XML tags)
- Reducing hallucinations or errors in outputs
- Debugging prompt performance issues

## Workflow

### Step 1: Understand Requirements

Ask clarifying questions to understand:
- **Task goal**: What should the prompt accomplish?
- **Use case**: One-time use, API integration, or production system?
- **Constraints**: Output format, length, style, tone requirements
- **Quality needs**: Consistency, accuracy, security priorities
- **Complexity**: Simple task or multi-step workflow?

### Step 2: Identify Applicable Techniques

Based on requirements, determine which techniques to apply:

**Core techniques (for all prompts):**
- Be clear and direct
- Use XML tags for structure

**Specialized techniques:**
- **Role-specific expertise** → System prompts
- **Complex reasoning** → Chain of thought
- **Format consistency** → Multishot prompting
- **Multi-step tasks** → Prompt chaining
- **Long documents** → Long context tips
- **Deep analysis** → Extended thinking
- **Factual accuracy** → Hallucination reduction
- **Output consistency** → Consistency techniques
- **Security concerns** → Jailbreak mitigation

### Step 3: Load Relevant References

Read the appropriate reference file(s) based on techniques needed:

**For basic prompt improvement:**
```
Read .github/skills/prompt-engineer/references/core_prompting.md
```
Covers: clarity, system prompts, XML tags

**For complex tasks:**
```
Read .github/skills/prompt-engineer/references/advanced_patterns.md
```
Covers: chain of thought, multishot, chaining, long context, extended thinking

**For specific quality issues:**
```
Read .github/skills/prompt-engineer/references/quality_improvement.md
```
Covers: hallucinations, consistency, security

### Step 4: Design the Prompt

Apply techniques from references to create the prompt structure:

**Basic Template:**
```
[System prompt - optional, for role assignment]

<context>
Relevant background information
</context>

<instructions>
Clear, specific task instructions
Use numbered steps for multi-step tasks
</instructions>

<examples>
  <example>
    <input>Sample input</input>
    <output>Expected output</output>
  </example>
  [2-4 more examples if using multishot]
</examples>

<output_format>
Specify exact format (JSON, XML, markdown, etc.)
</output_format>

[Actual task/question]
```

**Key Design Principles:**
1. **Clarity**: Be explicit and specific
2. **Structure**: Use XML tags to organize
3. **Examples**: Provide 3-5 concrete examples for complex formats
4. **Context**: Give relevant background
5. **Constraints**: Specify output requirements clearly

### Step 5: Add Quality Controls

Based on quality needs, add appropriate safeguards:

**For factual accuracy:**
- Grant permission to say "I don't know"
- Request quote extraction before analysis
- Require citations for claims
- Limit to provided information sources

**For consistency:**
- Provide explicit format specifications
- Use response prefilling
- Include diverse examples
- Consider prompt chaining

**For security:**
- Add harmlessness screening
- Establish clear ethical boundaries
- Implement input validation
- Use layered protection

### Step 6: Optimize and Test

**Optimization checklist:**
- [ ] Could someone with minimal context follow the instructions?
- [ ] Are all terms and requirements clearly defined?
- [ ] Is the desired output format explicitly specified?
- [ ] Are examples diverse and relevant?
- [ ] Are XML tags used consistently?
- [ ] Is the prompt as concise as possible while remaining clear?

### Step 7: Iterate Based on Results

**Common Issues and Solutions:**

| Issue | Solution | Reference |
|-------|----------|-----------|
| Inconsistent format | Add examples, use prefilling | quality_improvement.md |
| Hallucinations | Add uncertainty permission, quote grounding | quality_improvement.md |
| Missing steps | Break into subtasks, use chaining | advanced_patterns.md |
| Wrong tone | Add role to system prompt | core_prompting.md |
| Misunderstands task | Add clarity, provide context | core_prompting.md |
| Complex reasoning fails | Add chain of thought | advanced_patterns.md |

## Important Principles

**Progressive Disclosure**
Start with core techniques and add advanced patterns only when needed. Don't over-engineer simple prompts.

**Documentation**
When delivering prompts, explain which techniques were used and why. This helps users understand and maintain them.

**Validation**
Always validate critical outputs, especially for high-stakes applications. No prompting technique eliminates all errors.

**Experimentation**
Prompt engineering is iterative. Small changes can have significant impacts. Test variations and measure results.