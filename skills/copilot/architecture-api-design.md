# API Design Instructions for Copilot

When designing or implementing APIs, follow REST best practices:

## Resource-Oriented URLs

- Use plural nouns: `/api/users`, `/api/products`
- Not verbs: ❌ `/api/getUsers`, `/api/createProduct`
- Hierarchical for relationships: `/api/users/{id}/orders`

## HTTP Methods

- GET - retrieve (never modify data)
- POST - create new resource
- PUT - replace entire resource
- PATCH - partial update
- DELETE - remove resource

## Status Codes

- 200 OK, 201 Created, 204 No Content
- 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found
- 500 Internal Server Error

## Response Format

Consistent JSON with standardized errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{"field": "email", "message": "Invalid format"}]
  }
}
```

## Features

- Pagination: `?page=1&limit=50`
- Filtering: `?status=active&role=admin`
- Sorting: `?sort=createdAt&order=desc`
- Versioning: `/api/v1/users`

Design APIs with these principles for consistency and usability.
