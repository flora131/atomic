# Performance Optimization

Follow this data-driven approach to improving performance:

## Phase 1: Measure and Profile

**NEVER optimize without measuring first**

1. **Establish baseline metrics**
   - Response time (p50, p95, p99)
   - Throughput (requests per second)
   - CPU and memory usage
   - Database query times

2. **Identify the bottleneck**
   - Is it CPU-bound? (computation)
   - Is it I/O-bound? (database, network, disk)
   - Is it memory-bound? (garbage collection)

3. **Profile the application**
   - Use profiling tools to find WHERE time is spent
   - Focus on the 80/20 rule: optimize the 20% that takes 80% of time

## Phase 2: Optimization Strategies

### Database Optimization

**Add indexes for slow queries:**
```sql
-- Check if query is slow
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'user@example.com';
-- If showing full table scan, add index:
CREATE INDEX idx_users_email ON users(email);
```

**Fix N+1 queries:**
```javascript
// ❌ N+1 problem: 1 query + N queries
const posts = await Post.findAll();
for (const post of posts) {
  post.author = await User.findById(post.authorId);
}

// ✅ Solution: Eager loading
const posts = await Post.findAll({
  include: [{ model: User, as: 'author' }]
});
```

**Use pagination:**
```javascript
// ❌ Loading everything
const allUsers = await User.findAll(); // 100,000 users!

// ✅ Pagination
const users = await User.findAll({
  limit: 50,
  offset: (page - 1) * 50
});
```

### Caching

**Cache expensive computations:**
```javascript
const cache = new Map();

function expensiveOperation(input) {
  const cacheKey = JSON.stringify(input);

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const result = doExpensiveCalculation(input);
  cache.set(cacheKey, result);
  return result;
}
```

**Use Redis for distributed caching:**
```javascript
async function getCachedData(key) {
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  const data = await db.query(/* ... */);
  await redis.setex(key, 300, JSON.stringify(data)); // 5 min TTL
  return data;
}
```

**Cache HTTP responses:**
```javascript
app.get('/api/public/data', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  res.json(data);
});
```

### Algorithm Optimization

**Choose efficient data structures:**
```javascript
// ❌ Slow: Array lookup O(n)
const users = []; // Array
function hasUser(id) {
  return users.some(u => u.id === id); // O(n)
}

// ✅ Fast: Set lookup O(1)
const userIds = new Set(); // Set
function hasUser(id) {
  return userIds.has(id); // O(1)
}
```

**Reduce time complexity:**
```python
# ❌ O(n²): Nested loops
def find_duplicates(arr):
    duplicates = []
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                duplicates.append(arr[i])
    return duplicates

# ✅ O(n): Using set
def find_duplicates(arr):
    seen = set()
    duplicates = set()
    for item in arr:
        if item in seen:
            duplicates.add(item)
        seen.add(item)
    return list(duplicates)
```

### Lazy Loading

**Load resources on demand:**
```javascript
// ❌ Load everything upfront
import { HugeLibrary } from 'huge-library';

// ✅ Dynamic import
async function whenNeeded() {
  const { HugeLibrary } = await import('huge-library');
  return new HugeLibrary();
}
```

### Async and Parallel Processing

**Run independent operations in parallel:**
```javascript
// ❌ Sequential: 3 seconds total
const user = await fetchUser(id);      // 1 second
const posts = await fetchPosts(id);    // 1 second
const comments = await fetchComments(id); // 1 second

// ✅ Parallel: 1 second total
const [user, posts, comments] = await Promise.all([
  fetchUser(id),
  fetchPosts(id),
  fetchComments(id)
]);
```

**Use background jobs for heavy tasks:**
```javascript
// ❌ User waits for email
app.post('/api/signup', async (req, res) => {
  const user = await createUser(req.body);
  await sendWelcomeEmail(user.email); // Slow!
  res.json({ user });
});

// ✅ Queue email for background
app.post('/api/signup', async (req, res) => {
  const user = await createUser(req.body);
  await jobQueue.add('send-email', { userId: user.id });
  res.json({ user }); // Respond immediately
});
```

### Memory Optimization

**Stream large data:**
```javascript
// ❌ Load entire file into memory
const data = await fs.readFile('huge-file.json');
process(data);

// ✅ Stream data
const stream = fs.createReadStream('huge-file.json');
stream.on('data', chunk => process(chunk));
```

**Clean up event listeners:**
```javascript
// ❌ Memory leak: Never removed
function setupListener() {
  const handler = () => console.log('click');
  document.addEventListener('click', handler);
}

// ✅ Clean up
function setupListener() {
  const handler = () => console.log('click');
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
}
```

## Phase 3: Verification

**Measure the impact:**

1. Re-run performance tests
2. Compare before/after metrics
3. Ensure improvement is significant (>10%)
4. Monitor in production

## Critical Rules

- NEVER optimize without profiling first
- ALWAYS benchmark before and after
- Focus on bottlenecks, not everything
- Don't sacrifice readability for micro-optimizations
- Profile in production-like environment
- Monitor after deploying

## Quick Optimization Checklist

Before deploying optimization:
- ✅ Profiled to identify bottleneck
- ✅ Benchmarked before optimization
- ✅ Implemented optimization
- ✅ Benchmarked after optimization
- ✅ Verified >10% improvement
- ✅ Ensured functionality unchanged
- ✅ Code remains readable

## Common Quick Wins

1. Add database indexes for frequently queried columns
2. Fix N+1 queries with eager loading
3. Add caching for expensive/repeated operations
4. Use pagination for large datasets
5. Run independent operations in parallel
6. Move heavy tasks to background jobs

Apply these performance optimization practices systematically, always measuring before and after.
