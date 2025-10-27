# REST API Design Best Practices

When designing or implementing REST APIs, follow these principles:

## 1. Resource-Oriented Design

- Use **plural nouns** for collections: `/api/users`, `/api/products`
- NOT verbs: ❌ `/api/getUsers`, `/api/createProduct`
- Use hierarchical structure for relationships:
  - `/api/users/{userId}/orders` - orders belonging to a user
  - `/api/posts/{postId}/comments` - comments on a post
- Keep nesting to 2-3 levels maximum

## 2. HTTP Methods

Use standard HTTP methods correctly:

- **GET** - Retrieve resource(s), never modify data, idempotent
- **POST** - Create new resource, not idempotent
- **PUT** - Replace entire resource, idempotent
- **PATCH** - Partially update resource
- **DELETE** - Remove resource, idempotent

## 3. Status Codes

Use appropriate HTTP status codes:

**Success (2xx):**
- `200 OK` - Successful GET, PUT, PATCH, or DELETE
- `201 Created` - Successful POST with new resource
- `204 No Content` - Successful DELETE with no response body

**Client Errors (4xx):**
- `400 Bad Request` - Invalid input/validation error
- `401 Unauthorized` - Authentication required or failed
- `403 Forbidden` - Authenticated but lacking permissions
- `404 Not Found` - Resource doesn't exist
- `409 Conflict` - Conflict with current state

**Server Errors (5xx):**
- `500 Internal Server Error` - Generic server error
- `503 Service Unavailable` - Temporarily unavailable

## 4. Request and Response Format

Use consistent JSON format:

**Error responses (standardized):**
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
- Use camelCase (or snake_case) consistently
- Use ISO 8601 for dates: `2025-01-15T10:30:00Z`
- Include timestamps: `createdAt`, `updatedAt`

## 5. Filtering, Sorting, and Pagination

**Filtering:**
```
GET /api/users?status=active&role=admin
```

**Sorting:**
```
GET /api/users?sort=createdAt&order=desc
```

**Pagination:**
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

## 6. Versioning

Use URL versioning from the start:
```
/api/v1/users
/api/v2/users
```

Version when making breaking changes:
- Changing response structure
- Removing fields
- Changing field types

## 7. Authentication and Authorization

Use standard authentication:
- Bearer tokens (JWT): `Authorization: Bearer {token}`
- API keys: `X-API-Key: {key}`
- Always use HTTPS in production
- Return 401 for auth failures, 403 for permission issues

## 8. Documentation

Document every endpoint:
- Endpoint and method
- Description
- Authentication requirements
- Request parameters and body
- Response examples
- All possible status codes

## Critical Rules

- Design API before implementation - document endpoints first
- Use nouns for resources, not verbs
- Be consistent - pick conventions and stick to them
- Use proper HTTP methods - don't use POST for everything
- Return appropriate status codes
- Version from the start
- Document everything

## Good vs Bad Examples

**❌ Bad:**
```
POST /api/createUser
GET  /api/getUser?id=123
POST /api/deleteUser
GET  /api/product-list
```

**✅ Good:**
```
POST   /api/users
GET    /api/users/123
DELETE /api/users/123
GET    /api/products
```

Apply these principles to all API design and implementation.
