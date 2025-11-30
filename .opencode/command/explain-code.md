---
description: Explain code functionality in detail.
agent: build
model: anthropic/claude-sonnet-4-5
---

# Analyze and Explain Code Functionality

Analyze and explain code functionality: $ARGUMENTS

## Instructions

Follow this systematic approach to explain code:

1. **Code Context Analysis**
   - Identify the programming language and framework
   - Understand the broader context and purpose of the code
   - Identify the file location and its role in the project
   - Review related imports, dependencies, and configurations

2. **High-Level Overview**
   - Provide a summary of what the code does
   - Explain the main purpose and functionality
   - Identify the problem the code is solving
   - Describe how it fits into the larger system

3. **Code Structure Breakdown**
   - Break down the code into logical sections
   - Identify classes, functions, and methods
   - Explain the overall architecture and design patterns
   - Map out data flow and control flow

4. **Line-by-Line Analysis**
   - Explain complex or non-obvious lines of code
   - Describe variable declarations and their purposes
   - Explain function calls and their parameters
   - Clarify conditional logic and loops

5. **Algorithm and Logic Explanation**
   - Describe the algorithm or approach being used
   - Explain the logic behind complex calculations
   - Break down nested conditions and loops
   - Clarify recursive or asynchronous operations

6. **Data Structures and Types**
   - Explain data types and structures being used
   - Describe how data is transformed or processed
   - Explain object relationships and hierarchies
   - Clarify input and output formats

7. **Framework and Library Usage**
   - Explain framework-specific patterns and conventions
   - Describe library functions and their purposes
   - Explain API calls and their expected responses
   - Clarify configuration and setup code

8. **Error Handling and Edge Cases**
   - Explain error handling mechanisms
   - Describe exception handling and recovery
   - Identify edge cases being handled
   - Explain validation and defensive programming

9. **Performance Considerations**
   - Identify performance-critical sections
   - Explain optimization techniques being used
   - Describe complexity and scalability implications
   - Point out potential bottlenecks or inefficiencies

10. **Security Implications**
    - Identify security-related code sections
    - Explain authentication and authorization logic
    - Describe input validation and sanitization
    - Point out potential security vulnerabilities

## Explanation Format Examples

**For Complex Algorithms:**
```
This function implements a depth-first search algorithm:

1. Line 1-3: Initialize a stack with the starting node and a visited set
2. Line 4-8: Main loop - continue until stack is empty
3. Line 9-11: Pop a node and check if it's the target
4. Line 12-15: Add unvisited neighbors to the stack
5. Line 16: Return null if target not found

Time Complexity: O(V + E) where V is vertices and E is edges
Space Complexity: O(V) for the visited set and stack
```

**For API Integration Code:**
```
This code handles user authentication with a third-party service:

1. Extract credentials from request headers
2. Validate credential format and required fields
3. Make API call to authentication service
4. Handle response and extract user data
5. Create session token and set cookies
6. Return user profile or error response

Error Handling: Catches network errors, invalid credentials, and service unavailability
Security: Uses HTTPS, validates inputs, and sanitizes responses
```

## Language-Specific Considerations

**JavaScript/TypeScript:**
- Explain async/await and Promise handling
- Describe closure and scope behavior
- Clarify this binding and arrow functions
- Explain event handling and callbacks

**Python:**
- Explain list comprehensions and generators
- Describe decorator usage and purpose
- Clarify context managers and with statements
- Explain class inheritance and method resolution

**Go:**
- Explain goroutines and channel usage
- Describe interface implementation
- Clarify error handling patterns
- Explain package structure and imports

**Rust:**
- Explain ownership and borrowing
- Describe lifetime annotations
- Clarify pattern matching and Option/Result types
- Explain trait implementations

Remember to:
- Use clear, non-technical language when possible
- Provide examples and analogies for complex concepts
- Structure explanations logically from high-level to detailed
- Include visual diagrams or flowcharts when helpful
- Tailor the explanation level to the intended audience
