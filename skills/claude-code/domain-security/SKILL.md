---
name: domain-security
description: Security best practices - input validation, authentication, authorization, secrets management, and common vulnerability prevention
---

# Security Best Practices

## Description

This skill provides essential security guidelines for building secure applications. Security must be considered from the start - retrofitting security is expensive and often incomplete.

## When to Use

- **Designing new features** - consider security implications
- **Handling user input** - validate and sanitize
- **Implementing authentication/authorization** - secure by default
- **Working with secrets** - never hardcode credentials
- **Before deploying** - security checklist review
- **Code review** - check for security issues

## Prerequisites

- Understanding of common security vulnerabilities (OWASP Top 10)
- Knowledge of your application's threat model
- Familiarity with authentication/authorization concepts

## Instructions

### 1. Input Validation and Sanitization

**NEVER trust user input - validate everything**

1. **Validate at the boundary** (where input enters system)
   - Validate on server-side (not just client-side)
   - Check type, format, length, range
   - Reject invalid input early

2. **Whitelist approach** (safer than blacklist)
   - Define what IS allowed
   - Reject everything else
   - Don't try to list all bad inputs

3. **Sanitize for context**
   ```javascript
   // HTML context - escape HTML entities
   function escapeHtml(unsafe) {
     return unsafe
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;");
   }

   // SQL context - use parameterized queries
   // ❌ NEVER do this:
   const query = `SELECT * FROM users WHERE email = '${userEmail}'`;

   // ✅ DO this:
   const query = 'SELECT * FROM users WHERE email = ?';
   db.query(query, [userEmail]);

   // URL context - encode properly
   const url = `https://api.example.com/search?q=${encodeURIComponent(userQuery)}`;
   ```

### 2. Authentication

**Verify "who is the user?"**

1. **Password security**
   - Enforce minimum length (12+ characters)
   - Allow long passwords (64+ characters)
   - Don't restrict special characters
   - Use bcrypt, scrypt, or Argon2 for hashing
   - NEVER store plaintext passwords

   ```javascript
   // ✅ Good: Using bcrypt
   const bcrypt = require('bcrypt');
   const saltRounds = 12;

   async function hashPassword(password) {
     return await bcrypt.hash(password, saltRounds);
   }

   async function verifyPassword(password, hash) {
     return await bcrypt.compare(password, hash);
   }
   ```

2. **Session management**
   - Use secure, httpOnly cookies
   - Set appropriate session timeout
   - Regenerate session ID after login
   - Implement logout functionality

   ```javascript
   // ✅ Good: Secure cookie settings
   res.cookie('sessionId', sessionId, {
     httpOnly: true,   // Not accessible via JavaScript
     secure: true,     // Only sent over HTTPS
     sameSite: 'strict', // CSRF protection
     maxAge: 3600000   // 1 hour
   });
   ```

3. **Multi-factor authentication (MFA)**
   - Implement for sensitive operations
   - Support TOTP (Google Authenticator, Authy)
   - Provide backup codes

### 3. Authorization

**Verify "what can the user do?"**

1. **Principle of least privilege**
   - Grant minimum permissions needed
   - Users should only access their own data
   - Admins should have separate accounts for admin tasks

2. **Check authorization on every request**
   - Don't rely on hiding UI elements
   - Verify permissions server-side
   - Check both endpoint and data-level permissions

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

3. **Implement role-based access control (RBAC)**
   ```javascript
   const roles = {
     user: ['read:own'],
     moderator: ['read:any', 'update:any'],
     admin: ['read:any', 'update:any', 'delete:any']
   };

   function requirePermission(permission) {
     return (req, res, next) => {
       const userPermissions = roles[req.user.role] || [];
       if (!userPermissions.includes(permission)) {
         return res.status(403).json({ error: 'Forbidden' });
       }
       next();
     };
   }
   ```

### 4. Secrets Management

**NEVER hardcode secrets in code**

1. **Use environment variables**
   ```javascript
   // ❌ NEVER do this:
   const API_KEY = 'sk_live_abc123xyz789';

   // ✅ DO this:
   const API_KEY = process.env.API_KEY;

   if (!API_KEY) {
     throw new Error('API_KEY environment variable is required');
   }
   ```

2. **Keep secrets out of version control**
   ```bash
   # .gitignore
   .env
   .env.local
   secrets.json
   credentials.json
   *.key
   *.pem
   ```

3. **Use secret management services**
   - AWS Secrets Manager
   - HashiCorp Vault
   - Azure Key Vault
   - Google Secret Manager

4. **Rotate secrets regularly**
   - Have a rotation process
   - Don't reuse old secrets
   - Revoke compromised secrets immediately

### 5. HTTPS and Transport Security

**Always use HTTPS in production**

1. **Enforce HTTPS**
   ```javascript
   // Redirect HTTP to HTTPS
   app.use((req, res, next) => {
     if (req.headers['x-forwarded-proto'] !== 'https') {
       return res.redirect('https://' + req.hostname + req.url);
     }
     next();
   });
   ```

2. **Set security headers**
   ```javascript
   // Using Helmet middleware (Node.js)
   const helmet = require('helmet');
   app.use(helmet());

   // Manual headers
   app.use((req, res, next) => {
     res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
     res.setHeader('X-Content-Type-Options', 'nosniff');
     res.setHeader('X-Frame-Options', 'DENY');
     res.setHeader('X-XSS-Protection', '1; mode=block');
     res.setHeader('Content-Security-Policy', "default-src 'self'");
     next();
   });
   ```

### 6. Common Vulnerability Prevention

**Protect against OWASP Top 10**

1. **SQL Injection**
   ```python
   # ❌ NEVER do this:
   query = f"SELECT * FROM users WHERE id = {user_id}"

   # ✅ DO this (parameterized query):
   cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
   ```

2. **Cross-Site Scripting (XSS)**
   ```javascript
   // ❌ NEVER do this:
   element.innerHTML = userInput;

   // ✅ DO this:
   element.textContent = userInput;
   // Or use proper escaping/sanitization library
   ```

3. **Cross-Site Request Forgery (CSRF)**
   ```javascript
   // Use CSRF tokens for state-changing operations
   const csrf = require('csurf');
   const csrfProtection = csrf({ cookie: true });

   app.post('/api/transfer', csrfProtection, (req, res) => {
     // Handle transfer
   });
   ```

4. **Insecure Deserialization**
   ```python
   # ❌ NEVER do this:
   import pickle
   data = pickle.loads(untrusted_input)

   # ✅ DO this:
   import json
   data = json.loads(trusted_json)
   ```

5. **XML External Entities (XXE)**
   ```python
   # ✅ Disable external entity processing
   import defusedxml.ElementTree as ET
   tree = ET.parse(xml_file)
   ```

### 7. API Security

**Secure your APIs**

1. **Rate limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');

   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each IP to 100 requests per windowMs
   });

   app.use('/api/', limiter);
   ```

2. **Authentication for APIs**
   ```javascript
   // Use Bearer tokens (JWT)
   const jwt = require('jsonwebtoken');

   function authenticateToken(req, res, next) {
     const authHeader = req.headers['authorization'];
     const token = authHeader && authHeader.split(' ')[1];

     if (!token) {
       return res.status(401).json({ error: 'No token provided' });
     }

     jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
       if (err) {
         return res.status(403).json({ error: 'Invalid token' });
       }
       req.user = user;
       next();
     });
   }
   ```

3. **CORS configuration**
   ```javascript
   const cors = require('cors');

   // ❌ DON'T allow all origins in production:
   app.use(cors());

   // ✅ DO specify allowed origins:
   app.use(cors({
     origin: ['https://yourdomain.com'],
     credentials: true
   }));
   ```

### 8. Logging and Monitoring

**Detect and respond to security incidents**

1. **Log security events**
   - Failed login attempts
   - Authorization failures
   - Input validation errors
   - Unusual patterns

2. **Don't log sensitive data**
   - ❌ Passwords (even hashed)
   - ❌ Credit card numbers
   - ❌ API keys
   - ❌ Session tokens

3. **Monitor for anomalies**
   - Unusual access patterns
   - Spike in errors
   - Repeated failed authentications

## Critical Rules

- **NEVER trust user input** - validate everything
- **NEVER store passwords in plaintext** - use bcrypt/scrypt/Argon2
- **NEVER hardcode secrets** - use environment variables
- **ALWAYS use HTTPS** in production
- **ALWAYS check authorization** server-side
- **ALWAYS use parameterized queries** - prevent SQL injection
- **Escape output based on context** - prevent XSS

## Security Checklist

Before deploying, verify:

- ✅ All user input is validated and sanitized
- ✅ Passwords are hashed with strong algorithm
- ✅ Sessions are secure (httpOnly, secure, sameSite cookies)
- ✅ Authorization checks on all endpoints
- ✅ No secrets in code or version control
- ✅ HTTPS enforced
- ✅ Security headers configured
- ✅ Rate limiting implemented
- ✅ CORS properly configured
- ✅ Error messages don't leak sensitive info
- ✅ Dependencies are up-to-date (no known vulnerabilities)
- ✅ Logging doesn't include sensitive data

## Examples

### Example 1: Secure User Registration

```javascript
const bcrypt = require('bcrypt');
const validator = require('validator');

async function registerUser(req, res) {
  const { email, password, name } = req.body;

  // 1. Input validation
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  if (name.length > 100) {
    return res.status(400).json({ error: 'Name too long' });
  }

  // 2. Sanitize input
  const sanitizedName = validator.escape(name.trim());

  // 3. Check if user exists
  const existingUser = await User.findByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // 4. Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // 5. Create user (never store plaintext password)
  const user = await User.create({
    email: email.toLowerCase(),
    password: hashedPassword,
    name: sanitizedName
  });

  // 6. Don't return password in response
  const { password: _, ...userWithoutPassword } = user;

  // 7. Log security event (without sensitive data)
  logger.info('User registered', { userId: user.id, email: user.email });

  res.status(201).json(userWithoutPassword);
}
```

### Example 2: Secure File Upload

```javascript
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// 1. Configure file upload limits
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    // 2. Whitelist allowed file types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }

    // 3. Check file extension
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return cb(new Error('Invalid file extension'));
    }

    cb(null, true);
  }
});

app.post('/api/upload', authenticateUser, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 4. Generate random filename (don't trust user's filename)
  const randomName = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(req.file.originalname);
  const filename = `${randomName}${ext}`;

  // 5. Store in user-specific directory
  const userDir = path.join(__dirname, 'uploads', req.user.id);
  await fs.promises.mkdir(userDir, { recursive: true });

  const filepath = path.join(userDir, filename);
  await fs.promises.writeFile(filepath, req.file.buffer);

  res.json({ filename, url: `/uploads/${req.user.id}/${filename}` });
});
```

## Validation

After implementing security measures, verify:

- ✅ Penetration testing performed (if applicable)
- ✅ Security headers verified (securityheaders.com)
- ✅ Dependencies scanned for vulnerabilities (npm audit, Snyk)
- ✅ Code reviewed for security issues
- ✅ Authentication/authorization tested
- ✅ Input validation tested with malicious input

## Common Pitfalls to Avoid

1. **Security through obscurity** - Don't rely on hiding implementation
2. **Client-side only validation** - Always validate server-side
3. **Rolling your own crypto** - Use established libraries
4. **Ignoring error messages** - They may leak info to attackers
5. **Not updating dependencies** - Old dependencies have known vulnerabilities
6. **Assuming internal network is safe** - Validate even internal requests

## Related Skills

- `workflow-tdd` - Write security tests
- `architecture-api-design` - Secure API design
- `domain-performance` - Some security measures affect performance

## Security Tools

- **Static Analysis**: ESLint (security plugins), Bandit (Python), Brakeman (Ruby)
- **Dependency Scanning**: npm audit, Snyk, OWASP Dependency-Check
- **Secret Scanning**: GitGuardian, TruffleHog, git-secrets
- **Penetration Testing**: OWASP ZAP, Burp Suite
- **Header Checking**: securityheaders.com

## Resources

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP Cheat Sheets: https://cheatsheetseries.owasp.org/
- CWE Top 25: https://cwe.mitre.org/top25/
