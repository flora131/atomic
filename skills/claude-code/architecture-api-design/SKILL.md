---
name: architecture-api-design
description: REST API design principles - resource-oriented, consistent naming, proper HTTP methods, versioning, and error handling
---

# API Design

## Description

This skill provides best practices for designing RESTful APIs that are intuitive, consistent, maintainable, and scalable. Good API design prevents future breaking changes and reduces developer friction.

## When to Use

- **Designing new API endpoints**
- **Refactoring existing APIs** for consistency
- **Adding new features to an API**
- **Before implementing API routes** (design first)
- **API review requests**

## Prerequisites

- Understand the resources/entities your API will expose
- Know your authentication/authorization requirements
- Understand versioning strategy (if applicable)
- Familiar with REST principles

## Instructions

### 1. Resource Identification

**Think in terms of resources (nouns), not actions (verbs)**

1. **Identify the core resources** your API exposes
   - Users, products, orders, comments, etc.
   - Resources should map to domain entities

2. **Use plural nouns for collections**
   - ✅ `/api/users` (good)
   - ❌ `/api/user` (bad)
   - ✅ `/api/orders` (good)
   - ❌ `/api/getOrders` (bad - verb in URL)

3. **Use hierarchical structure for relationships**
   - `/api/users/{userId}/orders` - orders belonging to a user
   - `/api/posts/{postId}/comments` - comments on a post
   - Keep nesting to 2-3 levels maximum

### 2. HTTP Methods (Verbs)

**Use standard HTTP methods correctly**

| Method | Purpose | Example | Idempotent? | Safe? |
|--------|---------|---------|-------------|-------|
| GET | Retrieve resource(s) | `GET /api/users/123` | Yes | Yes |
| POST | Create new resource | `POST /api/users` | No | No |
| PUT | Replace entire resource | `PUT /api/users/123` | Yes | No |
| PATCH | Partially update resource | `PATCH /api/users/123` | No | No |
| DELETE | Remove resource | `DELETE /api/users/123` | Yes | No |

**Key principles:**
- GET requests should NEVER modify data
- PUT replaces entire resource (send all fields)
- PATCH updates specific fields (send only changed fields)
- POST is for creation or non-idempotent operations

### 3. Status Codes

**Use appropriate HTTP status codes**

**Success codes (2xx):**
- `200 OK` - Successful GET, PUT, PATCH, or DELETE
- `201 Created` - Successful POST that creates a resource
- `204 No Content` - Successful DELETE with no response body

**Client error codes (4xx):**
- `400 Bad Request` - Invalid input/validation error
- `401 Unauthorized` - Authentication required or failed
- `403 Forbidden` - Authenticated but lacking permissions
- `404 Not Found` - Resource doesn't exist
- `409 Conflict` - Conflict with current state (e.g., duplicate)
- `422 Unprocessable Entity` - Semantic errors in request

**Server error codes (5xx):**
- `500 Internal Server Error` - Generic server error
- `503 Service Unavailable` - Service temporarily unavailable

### 4. Request and Response Format

**Design consistent request/response structures**

**Request body (JSON):**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com"
}
```

**Successful response:**
```json
{
  "id": "123",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

**Error response (standardized):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Email format is invalid"
      }
    ]
  }
}
```

**Naming conventions:**
- Use camelCase for JSON properties (or snake_case consistently)
- Use ISO 8601 for dates: `2025-01-15T10:30:00Z`
- Include timestamps: `createdAt`, `updatedAt`

### 5. Filtering, Sorting, and Pagination

**For collections, support query parameters**

**Filtering:**
```
GET /api/users?status=active&role=admin
GET /api/products?category=electronics&minPrice=100
```

**Sorting:**
```
GET /api/users?sort=createdAt&order=desc
GET /api/products?sort=price&order=asc
```

**Pagination (offset-based):**
```
GET /api/users?page=2&limit=50
Response:
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 50,
    "total": 500,
    "totalPages": 10
  }
}
```

**Pagination (cursor-based for large datasets):**
```
GET /api/users?cursor=eyJpZCI6MTIzfQ&limit=50
Response:
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6MTczfQ",
    "hasMore": true
  }
}
```

### 6. Versioning

**Plan for API evolution from the start**

**URL versioning (most common):**
```
/api/v1/users
/api/v2/users
```

**Header versioning:**
```
GET /api/users
Accept: application/vnd.myapi.v1+json
```

**When to version:**
- Breaking changes to response structure
- Removing fields
- Changing field types or semantics
- DO NOT version for backward-compatible additions

### 7. Authentication and Authorization

**Standard approaches:**

**Bearer token (JWT):**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**API key:**
```
X-API-Key: your-api-key-here
```

**OAuth 2.0:**
```
Authorization: Bearer {access_token}
```

**Security considerations:**
- Always use HTTPS in production
- Validate tokens on every request
- Implement rate limiting
- Return 401 for auth failures, 403 for permission issues

### 8. Documentation

**Every endpoint should document:**

1. **Endpoint and method**: `POST /api/users`
2. **Description**: What the endpoint does
3. **Authentication**: Required or optional
4. **Request parameters**: Path params, query params, body
5. **Response**: Success and error examples
6. **Status codes**: All possible codes

**Example endpoint documentation:**
```
POST /api/users
Description: Create a new user account
Authentication: Required (admin role)

Request Body:
{
  "firstName": "string (required)",
  "lastName": "string (required)",
  "email": "string (required, unique)",
  "role": "string (optional, default: 'user')"
}

Success Response (201):
{
  "id": "string",
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "role": "string",
  "createdAt": "datetime"
}

Error Responses:
- 400: Invalid input
- 401: Unauthorized
- 409: Email already exists
```

## Critical Rules

- **Design API before implementation** - Document endpoints first
- **Use nouns for resources, not verbs** - Resources are things, not actions
- **Be consistent** - Pick conventions and stick to them across all endpoints
- **Use proper HTTP methods** - Don't use POST for everything
- **Return appropriate status codes** - They communicate meaning
- **Version from the start** - Planning for change is easier than retrofitting
- **Document everything** - APIs are contracts; document them

## Examples

### Example 1: Well-Designed E-commerce API

```
# Products
GET    /api/v1/products              # List all products (paginated)
GET    /api/v1/products/{id}          # Get single product
POST   /api/v1/products              # Create product (admin only)
PUT    /api/v1/products/{id}          # Replace product (admin only)
PATCH  /api/v1/products/{id}          # Update product fields (admin only)
DELETE /api/v1/products/{id}          # Delete product (admin only)

# Product reviews
GET    /api/v1/products/{id}/reviews  # List reviews for product
POST   /api/v1/products/{id}/reviews  # Create review for product
DELETE /api/v1/reviews/{reviewId}     # Delete review (different resource path)

# Orders
GET    /api/v1/orders                # List user's orders
GET    /api/v1/orders/{id}            # Get single order
POST   /api/v1/orders                # Create new order
PATCH  /api/v1/orders/{id}            # Update order (e.g., cancel)

# User's cart (sub-resource)
GET    /api/v1/users/{userId}/cart    # Get user's cart
POST   /api/v1/users/{userId}/cart/items  # Add item to cart
DELETE /api/v1/users/{userId}/cart/items/{itemId}  # Remove item
```

### Example 2: Common Anti-Patterns (DON'T DO THIS)

**❌ Verbs in URLs:**
```
POST /api/createUser
GET  /api/getUser?id=123
POST /api/deleteUser
```

**✅ Correct approach:**
```
POST   /api/users
GET    /api/users/123
DELETE /api/users/123
```

**❌ Inconsistent naming:**
```
GET /api/users
GET /api/product-list
GET /api/GetOrders
```

**✅ Correct approach:**
```
GET /api/users
GET /api/products
GET /api/orders
```

**❌ Non-standard methods:**
```
GET  /api/users/123  (but actually deletes the user)
POST /api/users/search  (but actually just retrieves data)
```

**✅ Correct approach:**
```
DELETE /api/users/123
GET    /api/users?search=john
```

## Validation

After designing an API, verify:

- ✅ All endpoints use nouns (resources), not verbs (actions)
- ✅ HTTP methods are used correctly
- ✅ Status codes are appropriate
- ✅ Response format is consistent across all endpoints
- ✅ Error responses follow a standard structure
- ✅ Authentication/authorization is clearly defined
- ✅ Versioning strategy is in place
- ✅ All endpoints are documented
- ✅ Filtering, sorting, pagination are supported for collections

## Common Pitfalls to Avoid

1. **Verbs in URLs** - Use HTTP methods instead
2. **Inconsistent naming** - Pick camelCase or snake_case, stick to it
3. **Ignoring HTTP semantics** - Don't use POST for everything
4. **Poor error messages** - Return helpful, structured errors
5. **No versioning** - Breaking changes will hurt users
6. **Overly nested routes** - Keep to 2-3 levels maximum
7. **Exposing implementation details** - API should hide internal structure

## Related Skills

- `domain-security` - Security considerations for APIs
- `workflow-tdd` - Test API endpoints before implementation
- `domain-performance` - Performance optimization for APIs

## Tools and Standards

- **OpenAPI/Swagger**: Document APIs in standard format
- **Postman**: Test API endpoints
- **REST conventions**: Follow HTTP/REST standards (RFC 7231, etc.)
- **JSON Schema**: Validate request/response structures
