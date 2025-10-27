# Security Best Practices

Apply these security principles to all code:

## 1. Input Validation and Sanitization

**NEVER trust user input - validate everything:**

- Validate at the boundary (server-side, not just client-side)
- Use whitelist approach (define what IS allowed, reject everything else)
- Sanitize for context:

```javascript
// HTML context - escape HTML entities
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// SQL context - use parameterized queries
// ❌ NEVER:
const query = `SELECT * FROM users WHERE email = '${userEmail}'`;

// ✅ DO THIS:
const query = 'SELECT * FROM users WHERE email = ?';
db.query(query, [userEmail]);
```

## 2. Authentication

**Password security:**
- Enforce minimum 12+ characters
- Use bcrypt, scrypt, or Argon2 for hashing
- NEVER store plaintext passwords

```javascript
const bcrypt = require('bcrypt');
const saltRounds = 12;

async function hashPassword(password) {
  return await bcrypt.hash(password, saltRounds);
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}
```

**Session management:**
```javascript
res.cookie('sessionId', sessionId, {
  httpOnly: true,   // Not accessible via JavaScript
  secure: true,     // Only sent over HTTPS
  sameSite: 'strict', // CSRF protection
  maxAge: 3600000   // 1 hour
});
```

## 3. Authorization

**Check authorization on EVERY request:**

```javascript
// ❌ BAD: No authorization check
app.delete('/api/posts/:id', async (req, res) => {
  await Post.delete(req.params.id);
  res.send({ success: true });
});

// ✅ GOOD: Verify ownership
app.delete('/api/posts/:id', authenticateUser, async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (post.authorId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await post.delete();
  res.json({ success: true });
});
```

## 4. Secrets Management

**NEVER hardcode secrets:**

```javascript
// ❌ NEVER:
const API_KEY = 'sk_live_abc123xyz789';

// ✅ DO THIS:
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY environment variable is required');
}
```

**Keep secrets out of version control:**
```
# .gitignore
.env
.env.local
secrets.json
*.key
*.pem
```

## 5. HTTPS and Security Headers

**Always use HTTPS in production:**

```javascript
// Enforce HTTPS
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect('https://' + req.hostname + req.url);
  }
  next();
});

// Set security headers
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
```

## 6. Common Vulnerability Prevention

**SQL Injection:**
```python
# ❌ NEVER:
query = f"SELECT * FROM users WHERE id = {user_id}"

# ✅ DO THIS:
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

**Cross-Site Scripting (XSS):**
```javascript
// ❌ NEVER:
element.innerHTML = userInput;

// ✅ DO THIS:
element.textContent = userInput;
```

**Cross-Site Request Forgery (CSRF):**
```javascript
// Use CSRF tokens for state-changing operations
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

app.post('/api/transfer', csrfProtection, (req, res) => {
  // Handle transfer
});
```

## 7. API Security

**Rate limiting:**
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests
});

app.use('/api/', limiter);
```

**CORS configuration:**
```javascript
// ❌ DON'T allow all origins:
app.use(cors());

// ✅ DO specify allowed origins:
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true
}));
```

## 8. Logging

**Log security events but not sensitive data:**

Log:
- Failed login attempts
- Authorization failures
- Unusual patterns

DON'T log:
- ❌ Passwords (even hashed)
- ❌ Credit card numbers
- ❌ API keys
- ❌ Session tokens

## Security Checklist

Before deploying:
- ✅ All user input validated and sanitized
- ✅ Passwords hashed with strong algorithm (bcrypt/scrypt/Argon2)
- ✅ Sessions secure (httpOnly, secure, sameSite cookies)
- ✅ Authorization checks on all endpoints
- ✅ No secrets in code or version control
- ✅ HTTPS enforced
- ✅ Security headers configured
- ✅ Rate limiting implemented
- ✅ CORS properly configured
- ✅ Dependencies up-to-date (no known vulnerabilities)

## Critical Rules

- NEVER trust user input - validate everything
- NEVER store passwords in plaintext
- NEVER hardcode secrets
- ALWAYS use HTTPS in production
- ALWAYS check authorization server-side
- ALWAYS use parameterized queries
- Escape output based on context

Apply these security practices to all code, especially when handling user input, authentication, or sensitive data.
