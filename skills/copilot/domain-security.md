# Security Instructions for Copilot

When writing code, always apply these security practices:

## Input Validation

- NEVER trust user input
- Validate on server-side (not just client)
- Use parameterized queries for SQL:

```javascript
// ❌ NEVER
const query = `SELECT * FROM users WHERE email = '${userEmail}'`;

// ✅ ALWAYS
const query = 'SELECT * FROM users WHERE email = ?';
db.query(query, [userEmail]);
```

## Authentication

- Hash passwords with bcrypt/scrypt/Argon2 (12+ rounds)
- NEVER store plaintext passwords
- Use httpOnly, secure, sameSite cookies for sessions

## Authorization

- Check permissions on EVERY request server-side
- Verify user owns resource before allowing access
- Return 401 for auth failures, 403 for permission denials

## Secrets Management

- NEVER hardcode secrets in code
- Use environment variables: `process.env.API_KEY`
- Keep secrets out of git (.gitignore .env files)

## Common Vulnerabilities

- SQL Injection: Use parameterized queries
- XSS: Use `textContent`, not `innerHTML`
- CSRF: Use CSRF tokens for state-changing operations

## HTTPS & Headers

- Always enforce HTTPS in production
- Set security headers: HSTS, X-Content-Type-Options, X-Frame-Options

## Checklist

Before deploying:
- ✅ All input validated
- ✅ Passwords hashed properly
- ✅ Authorization checks on all endpoints
- ✅ No secrets in code
- ✅ HTTPS enforced
- ✅ Security headers set

Apply security from the start - it's harder to retrofit later.
