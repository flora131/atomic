# Performance Optimization Instructions for Copilot

When optimizing performance, follow this data-driven approach:

## 1. Measure First

- Establish baseline metrics (response time, throughput, CPU, memory)
- Profile to find bottleneck (CPU, I/O, or memory bound)
- Focus on 20% of code that takes 80% of time
- NEVER optimize without measuring

## 2. Database Optimization

- Add indexes for slow queries
- Fix N+1 queries with eager loading
- Use pagination for large datasets
- Implement connection pooling

## 3. Caching

- Cache expensive computations
- Use Redis for distributed caching
- Cache HTTP responses with Cache-Control headers
- Set appropriate TTLs

## 4. Algorithm Optimization

- Choose efficient data structures (Set vs Array for lookups)
- Reduce time complexity (O(n) vs O(n²))
- Avoid unnecessary iterations

## 5. Async & Parallel

- Run independent operations in parallel with Promise.all
- Use background jobs for heavy tasks
- Don't block user response for slow operations

## 6. Code Examples

```javascript
// ❌ Slow: Sequential
const user = await fetchUser(id);
const posts = await fetchPosts(id);
const comments = await fetchComments(id);

// ✅ Fast: Parallel
const [user, posts, comments] = await Promise.all([
  fetchUser(id),
  fetchPosts(id),
  fetchComments(id)
]);

// ❌ Slow: N+1 query
for (const post of posts) {
  post.author = await User.findById(post.authorId);
}

// ✅ Fast: Eager loading
const posts = await Post.findAll({
  include: [{ model: User, as: 'author' }]
});
```

## 3. Verify

- Re-run benchmarks after optimization
- Ensure >10% improvement
- Monitor in production
- Verify no regressions

Always measure before and after optimizing.
