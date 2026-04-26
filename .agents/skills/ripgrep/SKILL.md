---
name: ripgrep
description: Use when searching text in files, codebases, books, or documents. Use when finding files by pattern, searching large files that are too big to read fully, extracting specific content from many files, or when grep/find is too slow. Triggers on "search for", "find occurrences", "look for pattern", "search in files".
---

# Ripgrep (rg) - Fast Text Search Tool

## Overview

Ripgrep is a line-oriented search tool that recursively searches directories for regex patterns. It's **10-100x faster than grep** and respects `.gitignore` by default. Use it instead of grep, find, or manually reading large files.

**Core principle:** When you need to find text in files, use ripgrep. Don't read entire files into context when you can search them.

## When to Use

**Use ripgrep when:**
- Searching for text patterns across a codebase or directory
- Finding all occurrences of a function, variable, or string
- Searching through books, documentation, or large text files
- Files are too large to read fully into context
- Looking for specific content in many files at once
- Finding files that contain (or don't contain) certain patterns
- Extracting matching lines for analysis

**Don't use when:**
- You need the full file content (use Read tool)
- Simple glob pattern matching for filenames only (use Glob tool)
- You need structured data extraction (consider jq, awk)

## Quick Reference

| Task | Command |
|------|---------|
| Basic search | `rg "pattern" [path]` |
| Case insensitive | `rg -i "pattern"` |
| Smart case (auto) | `rg -S "pattern"` |
| Whole word only | `rg -w "word"` |
| Fixed string (no regex) | `rg -F "literal.string"` |
| Show context lines | `rg -C 3 "pattern"` (3 before & after) |
| Show line numbers | `rg -n "pattern"` (default in tty) |
| Only filenames | `rg -l "pattern"` |
| Files without match | `rg --files-without-match "pattern"` |
| Count matches | `rg -c "pattern"` |
| Only matching part | `rg -o "pattern"` |
| Invert match | `rg -v "pattern"` |
| Multiline search | `rg -U "pattern.*\nmore"` |

## File Filtering

### By File Type

Ripgrep has built-in file type definitions. Use `-t` to include, `-T` to exclude:

```bash
# Search only Python files
rg -t py "def main"

# Search only JavaScript and TypeScript
rg -t js -t ts "import"

# Exclude test files
rg -T test "function"

# List all known types
rg --type-list
```

**Common types:** `py`, `js`, `ts`, `rust`, `go`, `java`, `c`, `cpp`, `rb`, `php`, `html`, `css`, `json`, `yaml`, `md`, `txt`, `sh`

### By Glob Pattern

```bash
# Only .tsx files
rg -g "*.tsx" "useState"

# Exclude node_modules (in addition to gitignore)
rg -g "!node_modules/**" "pattern"

# Only files in src directory
rg -g "src/**" "pattern"

# Multiple globs
rg -g "*.js" -g "*.ts" "pattern"

# Case insensitive globs
rg --iglob "*.JSON" "pattern"
```

### By File Size

```bash
# Skip files larger than 1MB
rg --max-filesize 1M "pattern"
```

## Directory Control

```bash
# Limit depth
rg --max-depth 2 "pattern"

# Search hidden files (dotfiles)
rg --hidden "pattern"

# Follow symlinks
rg -L "pattern"

# Ignore all ignore files (.gitignore, etc.)
rg --no-ignore "pattern"

# Progressive unrestricted (-u can stack up to 3 times)
rg -u "pattern"      # --no-ignore
rg -uu "pattern"     # --no-ignore --hidden
rg -uuu "pattern"    # --no-ignore --hidden --binary
```

## Context Options

```bash
# Lines after match
rg -A 5 "pattern"

# Lines before match
rg -B 5 "pattern"

# Lines before and after
rg -C 5 "pattern"

# Print entire file on match (passthrough mode)
rg --passthru "pattern"
```

## Output Formats

```bash
# Just filenames with matches
rg -l "pattern"

# Files without matches
rg --files-without-match "pattern"

# Count matches per file
rg -c "pattern"

# Count total matches (not lines)
rg --count-matches "pattern"

# Only the matched text (not full line)
rg -o "pattern"

# JSON output (for parsing)
rg --json "pattern"

# Vim-compatible output (file:line:col:match)
rg --vimgrep "pattern"

# With statistics
rg --stats "pattern"
```

## Regex Patterns

Ripgrep uses Rust regex syntax by default:

```bash
# Alternation
rg "foo|bar"

# Character classes
rg "[0-9]+"
rg "[a-zA-Z_][a-zA-Z0-9_]*"

# Word boundaries
rg "\bword\b"

# Quantifiers
rg "colou?r"           # 0 or 1
rg "go+gle"            # 1 or more
rg "ha*"               # 0 or more
rg "x{2,4}"            # 2 to 4 times

# Groups
rg "(foo|bar)baz"

# Lookahead/lookbehind (requires -P for PCRE2)
rg -P "(?<=prefix)content"
rg -P "content(?=suffix)"
```

### Multiline Matching

```bash
# Enable multiline mode
rg -U "start.*\nend"

# Dot matches newline too
rg -U --multiline-dotall "start.*end"

# Match across lines
rg -U "function\s+\w+\([^)]*\)\s*\{"
```

## Replacement (Preview Only)

Ripgrep can show what replacements would look like (doesn't modify files):

```bash
# Simple replacement
rg "old" -r "new"

# Using capture groups
rg "(\w+)@(\w+)" -r "$2::$1"

# Remove matches (empty replacement)
rg "pattern" -r ""
```

## Searching Special Files

### Compressed Files

```bash
# Search in gzip, bzip2, xz, lz4, lzma, zstd files
rg -z "pattern" file.gz
rg -z "pattern" archive.tar.gz
```

### Binary Files

```bash
# Include binary files
rg --binary "pattern"

# Treat binary as text (may produce garbage)
rg -a "pattern"
```

### Large Files

For files too large to read into context:

```bash
# Search and show only matching lines
rg "specific pattern" large_file.txt

# Limit matches to first N per file
rg -m 10 "pattern" huge_file.log

# Show byte offset for large file navigation
rg -b "pattern" large_file.txt

# Use with head/tail for pagination
rg "pattern" large_file.txt | head -100
```

## Performance Tips

1. **Be specific with paths** - Don't search from root when you know the subdir
2. **Use file types** - `-t py` is faster than `-g "*.py"`
3. **Use fixed strings** - `-F` when you don't need regex
4. **Limit depth** - `--max-depth` when you know structure
5. **Let gitignore work** - Don't use `--no-ignore` unless needed
6. **Use word boundaries** - `-w` is optimized

## Common Patterns

### Find function definitions
```bash
# Python
rg "def \w+\(" -t py

# JavaScript/TypeScript
rg "(function|const|let|var)\s+\w+\s*=" -t js -t ts
rg "^\s*(async\s+)?function" -t js

# Go
rg "^func\s+\w+" -t go
```

### Find imports/requires
```bash
# Python
rg "^(import|from)\s+" -t py

# JavaScript
rg "^(import|require\()" -t js

# Go
rg "^import\s+" -t go
```

### Find TODO/FIXME comments
```bash
rg "(TODO|FIXME|HACK|XXX):"
```

### Find error handling
```bash
# Python
rg "except\s+\w+:" -t py

# JavaScript
rg "\.catch\(|catch\s*\(" -t js
```

### Find class definitions
```bash
# Python
rg "^class\s+\w+" -t py

# JavaScript/TypeScript
rg "^(export\s+)?(default\s+)?class\s+\w+" -t js -t ts
```

### Search in books/documents
```bash
# Find chapter headings
rg "^(Chapter|CHAPTER)\s+\d+" book.txt

# Find quoted text
rg '"[^"]{20,}"' document.txt

# Find paragraphs containing word
rg -C 2 "keyword" book.txt
```

## Combining with Other Tools

```bash
# Find files, then search
rg --files | xargs rg "pattern"

# Search and count by file
rg -c "pattern" | sort -t: -k2 -rn

# Search and open in editor
rg -l "pattern" | xargs code

# Extract unique matches
rg -o "\b[A-Z]{2,}\b" | sort -u

# Search multiple patterns from file
rg -f patterns.txt
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Matches found |
| 1 | No matches found |
| 2 | Error occurred |

Useful for scripting:
```bash
if rg -q "pattern" file.txt; then
    echo "Found"
fi
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Pattern has special chars | Use `-F` for fixed strings or escape: `rg "foo\.bar"` |
| Can't find hidden files | Add `--hidden` or `-uu` |
| Missing node_modules | Add `--no-ignore` (but it's usually right to skip) |
| Regex too complex | Try `-P` for PCRE2 with lookahead/lookbehind |
| Output too long | Use `-m N` to limit, or `-l` for just filenames |
| Binary file skipped | Add `--binary` or `-a` for text mode |
| Need to see full line | Remove `-o` (only-matching) flag |

## When to Prefer Other Tools

| Task | Better Tool |
|------|-------------|
| Structured JSON queries | `jq` |
| Column-based text processing | `awk` |
| Stream editing/substitution | `sed` (actually modifies files) |
| Find files by name only | `fd` or `find` |
| Simple file listing | `ls` or `glob` |
| Full file content needed | Read tool |
