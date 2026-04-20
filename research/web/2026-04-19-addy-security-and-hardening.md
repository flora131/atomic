---
source_url: https://raw.githubusercontent.com/addyosmani/agent-skills/44dac80216da709913fb410f632a65547866346f/skills/security-and-hardening/SKILL.md
fetched_at: 2026-04-19
fetch_method: markdown-accept-header
topic: Security and Hardening skill from addyosmani/agent-skills
---

# security-and-hardening SKILL.md (verbatim)

---
name: security-and-hardening
description: Hardens code against vulnerabilities. Use when handling user input, authentication, data storage, or external integrations. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services.
---

## When to Use
- Building anything that accepts user input
- Implementing authentication or authorization
- Storing or transmitting sensitive data
- Integrating with external APIs or services
- Adding file uploads, webhooks, or callbacks
- Handling payment or PII data

## Three-Tier Boundary System

### Always Do (No Exceptions)
- Validate all external input at the system boundary
- Parameterize all database queries
- Encode output to prevent XSS
- Use HTTPS for all external communication
- Hash passwords with bcrypt/scrypt/argon2
- Set security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Use httpOnly, secure, sameSite cookies for sessions
- Run `npm audit` before every release

### Ask First (Requires Human Approval) — Escalation Gates
- Adding new authentication flows or changing auth logic
- Storing new categories of sensitive data (PII, payment info)
- Adding new external service integrations
- Changing CORS configuration
- Adding file upload handlers
- Modifying rate limiting or throttling
- Granting elevated permissions or roles

### Never Do
- Never commit secrets to version control
- Never log sensitive data
- Never trust client-side validation as security boundary
- Never disable security headers for convenience
- Never use eval() or innerHTML with user-provided data
- Never store sessions in localStorage for auth tokens
- Never expose stack traces or internal error details to users

## Step-by-Step Process (OWASP Top 10 Prevention)
1. Injection — parameterized queries / ORM only
2. Broken Authentication — bcrypt SALT_ROUNDS >= 12, httpOnly/secure/sameSite session cookies
3. XSS — framework auto-escaping; DOMPurify if raw HTML required
4. Broken Access Control — check ownerId on every protected resource
5. Security Misconfiguration — helmet middleware; CSP directives; CORS restricted to known origins
6. Sensitive Data Exposure — sanitizeUser() strips passwordHash/resetToken from responses

## Artifacts Produced
- Security review checklist (completed markdown)
- npm audit output / remediation notes
- No separate report artifact — checklist serves as the artifact

## Human-in-the-Loop / Escalation Gates
Items in "Ask First" tier all require human approval before proceeding:
- New auth flows, new PII storage categories, new external integrations, CORS config changes, file upload handlers, rate limit changes, permission grants.

npm audit triage: critical/high + reachable in production = fix immediately; defer others with documented reason and review date.

## Exit Criteria / Verification Checklist
- [ ] `npm audit` shows no critical or high vulnerabilities
- [ ] No secrets in source code or git history
- [ ] All user input validated at system boundaries
- [ ] Authentication and authorization checked on every protected endpoint
- [ ] Security headers present in response
- [ ] Error responses don't expose internal details
- [ ] Rate limiting active on auth endpoints

## Cross-References / Supporting Files
- `references/security-checklist.md` (detailed checklists and pre-commit verification steps)
- No additional files in this skill directory (SKILL.md only).
