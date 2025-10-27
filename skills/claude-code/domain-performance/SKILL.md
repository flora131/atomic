---
name: domain-performance
description: Performance optimization - profiling, identifying bottlenecks, database optimization, caching, and measuring improvements
---

# Performance Optimization

## Description

This skill provides a systematic approach to improving application performance. Performance optimization should be data-driven: measure first, optimize bottlenecks, then verify improvements.

## When to Use

- **Performance issues reported** - slow response times, high CPU/memory
- **Before scaling** - optimize before throwing hardware at the problem
- **After implementing new features** - verify performance impact
- **During code review** - identify potential performance issues
- **Capacity planning** - understand system limits

## Prerequisites

- Ability to reproduce performance issues
- Access to profiling tools for your language/platform
- Understanding of system architecture
- Baseline performance metrics

## Instructions

### Phase 1: Measure and Profile

**NEVER optimize without measuring first**

1. **Establish baseline metrics**
   - Response time (p50, p95, p99)
   - Throughput (requests per second)
   - CPU and memory usage
   - Database query times
   - Error rates

2. **Identify the bottleneck**
   ```
   Use profiling tools to find WHERE time is spent:
   - Is it CPU-bound? (computation)
   - Is it I/O-bound? (database, network, disk)
   - Is it memory-bound? (garbage collection, swapping)
   ```

3. **Profile the application**
   - **Backend**: Use language-specific profilers
   - **Frontend**: Use browser DevTools
   - **Database**: Enable query logging and analysis
   - **Network**: Use network monitoring tools

4. **Focus on the 80/20 rule**
   - Find the 20% of code that takes 80% of the time
   - Optimize the hot path first
   - Don't optimize code that rarely runs

### Phase 2: Optimization Strategies

**Apply appropriate optimization techniques**

#### A. Database Optimization

1. **Add indexes for slow queries**
   ```sql
   -- ❌ Slow: Full table scan
   SELECT * FROM users WHERE email = 'user@example.com';

   -- ✅ Fast: With index
   CREATE INDEX idx_users_email ON users(email);
   SELECT * FROM users WHERE email = 'user@example.com';
   ```

2. **Optimize N+1 queries**
   ```javascript
   // ❌ N+1 problem: 1 query + N queries for authors
   const posts = await Post.findAll();
   for (const post of posts) {
     post.author = await User.findById(post.authorId);
   }

   // ✅ Solution: Use eager loading/join
   const posts = await Post.findAll({
     include: [{ model: User, as: 'author' }]
   });
   ```

3. **Use pagination for large datasets**
   ```javascript
   // ❌ Loading everything
   const allUsers = await User.findAll(); // 100,000 users!

   // ✅ Pagination
   const users = await User.findAll({
     limit: 50,
     offset: (page - 1) * 50
   });
   ```

4. **Add database connection pooling**
   ```javascript
   // ✅ Reuse connections
   const pool = new Pool({
     max: 20,           // Maximum connections
     min: 5,            // Minimum connections
     idleTimeoutMillis: 30000
   });
   ```

#### B. Caching

1. **Cache expensive computations**
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

2. **Use Redis for distributed caching**
   ```javascript
   async function getCachedData(key) {
     // Check cache first
     const cached = await redis.get(key);
     if (cached) {
       return JSON.parse(cached);
     }

     // Cache miss - fetch from database
     const data = await db.query(/* ... */);

     // Store in cache with TTL
     await redis.setex(key, 300, JSON.stringify(data)); // 5 minutes

     return data;
   }
   ```

3. **Cache HTTP responses**
   ```javascript
   // Cache-Control headers
   app.get('/api/public/data', (req, res) => {
     res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
     res.json(data);
   });

   // ETags for conditional requests
   app.get('/api/data', (req, res) => {
     const etag = generateETag(data);
     if (req.headers['if-none-match'] === etag) {
       return res.status(304).end(); // Not Modified
     }
     res.set('ETag', etag);
     res.json(data);
   });
   ```

#### C. Algorithm Optimization

1. **Choose efficient data structures**
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

2. **Reduce time complexity**
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

#### D. Lazy Loading and Code Splitting

1. **Load resources on demand**
   ```javascript
   // ❌ Load everything upfront
   import { HugeLibrary } from 'huge-library';

   // ✅ Dynamic import
   async function whenNeeded() {
     const { HugeLibrary } = await import('huge-library');
     return new HugeLibrary();
   }
   ```

2. **Code splitting (React example)**
   ```javascript
   // ✅ Lazy load components
   import React, { lazy, Suspense } from 'react';

   const HeavyComponent = lazy(() => import('./HeavyComponent'));

   function App() {
     return (
       <Suspense fallback={<div>Loading...</div>}>
         <HeavyComponent />
       </Suspense>
     );
   }
   ```

#### E. Async and Parallel Processing

1. **Run independent operations in parallel**
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

2. **Use background jobs for heavy tasks**
   ```javascript
   // ❌ Slow: User waits for email to send
   app.post('/api/signup', async (req, res) => {
     const user = await createUser(req.body);
     await sendWelcomeEmail(user.email); // Slow!
     res.json({ user });
   });

   // ✅ Fast: Queue email for background processing
   app.post('/api/signup', async (req, res) => {
     const user = await createUser(req.body);
     await jobQueue.add('send-email', { userId: user.id });
     res.json({ user }); // Respond immediately
   });
   ```

#### F. Memory Optimization

1. **Avoid memory leaks**
   ```javascript
   // ❌ Memory leak: Event listener never removed
   function setupListener() {
     const handler = () => console.log('click');
     document.addEventListener('click', handler);
   }

   // ✅ Clean up listeners
   function setupListener() {
     const handler = () => console.log('click');
     document.addEventListener('click', handler);
     return () => document.removeEventListener('click', handler);
   }
   ```

2. **Stream large data instead of loading all at once**
   ```javascript
   // ❌ Load entire file into memory
   const data = await fs.readFile('huge-file.json');
   process(data);

   // ✅ Stream data
   const stream = fs.createReadStream('huge-file.json');
   stream.on('data', chunk => process(chunk));
   ```

### Phase 3: Verification

**Measure the impact of optimizations**

1. **Re-run performance tests**
   - Compare before/after metrics
   - Ensure improvement is significant (>10%)
   - Check that functionality is unchanged

2. **Monitor in production**
   - Deploy changes
   - Watch real-world metrics
   - Verify no regressions

3. **Load testing**
   ```bash
   # Use tools like Apache Bench, k6, or Artillery
   ab -n 1000 -c 10 http://localhost:3000/api/endpoint
   ```

## Critical Rules

- **NEVER optimize without profiling** - Measure first!
- **ALWAYS benchmark before and after** - Verify improvements
- **Focus on bottlenecks** - Optimize the slowest parts first
- **Don't sacrifice readability for micro-optimizations** - Clarity matters
- **Profile in production-like environment** - Dev environment ≠ production
- **Monitor after deploying** - Verify improvements in real-world usage

## Examples

### Example 1: Optimizing a Slow API Endpoint

**Problem:** API endpoint taking 2 seconds to respond

**Phase 1: Measure and Profile**
```javascript
// Add timing logs
console.time('total');
console.time('database');
const user = await User.findById(userId);
console.timeEnd('database'); // 1800ms! ⬅️ Bottleneck found

console.time('processing');
const processed = processData(user);
console.timeEnd('processing'); // 50ms

res.json(processed);
console.timeEnd('total'); // 1850ms
```

**Bottleneck identified:** Database query taking 1.8 seconds

**Phase 2: Optimization**
```sql
-- Check query plan
EXPLAIN ANALYZE SELECT * FROM users WHERE id = 123;
-- Result: Seq Scan on users (cost=0.00..1234.00)
-- Problem: No index on id column!

-- Add index
CREATE INDEX idx_users_id ON users(id);

-- Re-check query plan
EXPLAIN ANALYZE SELECT * FROM users WHERE id = 123;
-- Result: Index Scan using idx_users_id (cost=0.00..8.27)
```

**Phase 3: Verification**
```javascript
console.time('database');
const user = await User.findById(userId);
console.timeEnd('database'); // 5ms ✓ (360x improvement!)

console.time('total');
// ... full request ...
console.timeEnd('total'); // 55ms ✓ (33x improvement!)
```

### Example 2: Frontend Performance Optimization

**Problem:** Page loads slowly, feels sluggish

**Phase 1: Measure and Profile**
```
Chrome DevTools Performance tab shows:
- 500ms parsing huge JavaScript bundle
- 200ms rendering large list
- 100ms re-rendering on every scroll
```

**Phase 2: Optimization**

1. **Code splitting:**
```javascript
// Before: 500kb bundle
import { ComponentA, ComponentB, ComponentC } from './components';

// After: Split into smaller chunks
const ComponentA = lazy(() => import('./ComponentA'));
const ComponentB = lazy(() => import('./ComponentB'));
const ComponentC = lazy(() => import('./ComponentC'));
```

2. **Virtualize long lists:**
```javascript
// ❌ Before: Renders 10,000 items
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>

// ✅ After: Only renders visible items
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={items.length}
  itemSize={35}
>
  {({ index, style }) => (
    <div style={style}>{items[index].name}</div>
  )}
</FixedSizeList>
```

3. **Debounce expensive operations:**
```javascript
// ❌ Before: Re-renders on every scroll event (100+ times/second)
window.addEventListener('scroll', handleScroll);

// ✅ After: Debounce to run at most once per 100ms
import debounce from 'lodash/debounce';

const debouncedHandleScroll = debounce(handleScroll, 100);
window.addEventListener('scroll', debouncedHandleScroll);
```

**Phase 3: Verification**
```
Chrome DevTools Performance tab after optimization:
- 50ms parsing JavaScript (10x improvement!)
- 20ms initial render (10x improvement!)
- Smooth scrolling (no janky re-renders)

Lighthouse score: 45 → 92 ✓
```

## Validation

After optimizing, verify:

- ✅ Performance metrics improved significantly (>10%)
- ✅ No regressions in other areas
- ✅ Functionality remains unchanged
- ✅ Code is still readable and maintainable
- ✅ Improvements verified in production environment
- ✅ Load testing shows improved capacity

## Common Pitfalls to Avoid

1. **Premature optimization** - Optimize bottlenecks, not everything
2. **Optimizing without measuring** - You might optimize the wrong thing
3. **Micro-optimizations at the cost of readability** - Clarity > tiny gains
4. **Not considering scalability** - Will this work with 10x load?
5. **Ignoring caching** - Often the easiest big win
6. **Not monitoring production** - Dev performance ≠ production performance

## Performance Profiling Tools

**Backend:**
- **Node.js**: Node.js built-in profiler, clinic.js
- **Python**: cProfile, py-spy
- **Ruby**: rack-mini-profiler, ruby-prof
- **Java**: JProfiler, YourKit
- **Go**: pprof

**Frontend:**
- **Chrome DevTools**: Performance tab, Lighthouse
- **React**: React DevTools Profiler
- **Bundle Analysis**: webpack-bundle-analyzer

**Database:**
- **PostgreSQL**: EXPLAIN ANALYZE, pg_stat_statements
- **MySQL**: EXPLAIN, slow query log
- **MongoDB**: explain(), Database Profiler

**Load Testing:**
- **Apache Bench (ab)**: Simple HTTP load testing
- **k6**: Modern load testing tool
- **Artillery**: Load testing and smoke testing
- **JMeter**: Complex load testing scenarios

## Related Skills

- `workflow-debugging` - Performance issues are bugs
- `domain-security` - Some optimizations affect security
- `architecture-api-design` - Design affects performance

## Key Performance Metrics

**Backend:**
- Response time (p50, p95, p99)
- Throughput (req/sec)
- Error rate
- CPU usage
- Memory usage
- Database query time

**Frontend:**
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Time to Interactive (TTI)
- Cumulative Layout Shift (CLS)
- First Input Delay (FID)
- Bundle size

**General:**
- Time To First Byte (TTFB)
- Page load time
- API latency
