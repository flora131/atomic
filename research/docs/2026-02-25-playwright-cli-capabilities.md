# Playwright CLI Capabilities Research

**Date**: February 25, 2026  
**Repository**: microsoft/playwright-cli  
**Related Repositories**: microsoft/playwright, anthropics/anthropic-cookbook  
**Research Method**: DeepWiki AI-powered repository analysis

---

## Executive Summary

Playwright CLI (`@playwright/cli`) is a token-efficient command-line interface designed specifically for coding agents and AI assistants to automate browser interactions. It is located within the Playwright monorepo at `packages/playwright/src/mcp/terminal/` and provides a streamlined alternative to Playwright MCP for high-throughput coding agents. The CLI emphasizes efficiency by avoiding large tool schemas and verbose accessibility trees, making it ideal for AI agent integration.

**Key Highlights:**
- **Purpose**: Browser automation for testing, form filling, screenshots, and data extraction
- **Primary Audience**: Coding agents and AI assistants
- **Distribution**: npm package `@playwright/cli`
- **Token Efficiency**: Designed to minimize context usage for AI models
- **Browser Support**: Chromium, Firefox, WebKit, MS Edge
- **Session Management**: Supports persistent and named sessions for state preservation

---

## 1. What is Playwright CLI?

### Overview and Purpose

Playwright CLI is a command-line interface for Playwright designed to automate browser interactions for tasks such as web testing, form filling, taking screenshots, and data extraction.

**Source References:**
- `microsoft/playwright-cli` README.md
- Wiki: [Getting Started](https://deepwiki.com/wiki/microsoft/playwright-cli#2)
- Monorepo location: `https://github.com/microsoft/playwright/tree/main/packages/playwright/src/mcp/terminal`

### Primary Design Goal

The CLI provides a **token-efficient way for coding agents** to interact with browsers, avoiding the overhead of larger tool schemas and verbose accessibility trees that are present in Playwright MCP.

### Key Capabilities

1. **Browser Automation and Interaction**
   - Open browsers and navigate to URLs
   - Interact with page elements using element references (e.g., `e1`, `e2`)
   - Execute commands like `click`, `fill`, `type`, `press`
   - Support for all major browsers (Chromium, Firefox, WebKit, MS Edge)

2. **Session Management**
   - **Default Session**: In-memory browser profile (cookies/storage preserved between commands, lost on close)
   - **Persistent Sessions**: `--persistent` flag saves profile to disk, preserving data across restarts
   - **Named Sessions**: `-s=` flag creates isolated browser instances for concurrent automation
   - **Session Control**: Commands like `list`, `close-all`, `kill-all`

3. **Output Artifacts**
   - `screenshot [ref]`: Capture screenshots of pages or elements
   - `pdf`: Save current page as PDF
   - `snapshot`: Capture page snapshot with element references (saved as YAML files)

4. **Browser Types and Display Modes**
   - Support for multiple browsers via `--browser` flag
   - Headless mode (default) or headed mode with `--headed` flag

5. **Advanced Capabilities**
   - Request mocking: Intercept, mock, modify, and block network requests
   - Running custom Playwright code with `run-code` command
   - Storage state management (cookies, localStorage, sessionStorage)
   - Tracing and video recording for debugging

**Source Reference:** Wiki [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)

---

## 2. Installation Methods

### Global Installation (Recommended)

The recommended method is global installation for system-wide access:

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
```

**Package Details:**
- **npm Package**: `@playwright/cli`
- **Binary Name**: `playwright-cli`
- **Entry Point**: `playwright-cli.js`

### Local Installation

For project-specific installations:

```bash
npm install @playwright/cli
npx playwright-cli --help
```

When using local installation, prefix all commands with `npx`:

```bash
npx playwright-cli open https://example.com
npx playwright-cli click e1
```

### Installation Notes

- No standalone binary distribution outside of npm is currently available
- The CLI is a Node.js package requiring Node.js runtime
- Browser binaries are automatically downloaded by Playwright on installation

**Source References:**
- Wiki: [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
- `package.json` in repository
- DeepWiki search: [Installation methods](https://deepwiki.com/search/how-do-you-install-playwright_93627ae0-c074-4105-8518-239fa410e4fd)

---

## 3. CLI Commands and API

Playwright CLI provides a comprehensive set of commands categorized by function:

### Core Commands

| Command | Purpose | Source |
|---------|---------|--------|
| `open [url]` | Launch browser, optionally navigate to URL | README.md, SKILL.md |
| `goto <url>` | Navigate to specified URL | README.md |
| `close` | Close current browser page/session | README.md |
| `type <text>` | Type text into focused element | README.md |
| `click <ref> [button]` | Click element by reference | README.md |
| `dblclick <ref> [button]` | Double-click element | README.md |
| `fill <ref> <text>` | Fill text input field | README.md |
| `drag <startRef> <endRef>` | Drag and drop operation | README.md |
| `hover <ref>` | Hover over element | README.md |
| `select <ref> <val>` | Select dropdown option | README.md |
| `upload <file>` | Upload file(s) | README.md |
| `check <ref>` | Check checkbox/radio button | README.md |
| `uncheck <ref>` | Uncheck checkbox | README.md |
| `snapshot` | Capture page snapshot for element references | README.md |
| `eval <func> [ref]` | Evaluate JavaScript on page/element | README.md |
| `dialog-accept [prompt]` | Accept dialog with optional prompt | README.md |
| `dialog-dismiss` | Dismiss dialog | README.md |
| `resize <w> <h>` | Resize browser window | README.md |

### Navigation Commands

- `go-back`: Navigate to previous page
- `go-forward`: Navigate to next page
- `reload`: Reload current page

### Keyboard Commands

- `press <key>`: Press single key
- `keydown <key>`: Press key down
- `keyup <key>`: Release key

### Mouse Commands

- `mousemove <x> <y>`: Move mouse to position
- `mousedown [button]`: Press mouse button
- `mouseup [button]`: Release mouse button
- `mousewheel <dx> <dy>`: Scroll mouse wheel

### Save Artifact Commands

- `screenshot [ref]`: Screenshot page or element
- `pdf`: Save page as PDF

### Tab Management Commands

- `tab-list`: List all open tabs
- `tab-new [url]`: Create new tab
- `tab-close [index]`: Close tab by index
- `tab-select <index>`: Select tab by index

### Storage Management Commands

- `state-save [filename]`: Save storage state
- `state-load <filename>`: Load storage state
- `cookie-list [--domain]`: List cookies
- `cookie-get <name>`: Get specific cookie
- `cookie-set <name> <val>`: Set cookie
- `cookie-delete <name>`: Delete cookie
- `localstorage-list`: List localStorage items
- `localstorage-get <key>`: Get localStorage value
- `localstorage-set <key> <val>`: Set localStorage value
- `localstorage-delete <key>`: Delete localStorage item
- `sessionstorage-list`: List sessionStorage items
- (Similar commands for sessionStorage)

### Network and DevTools Commands

- `route <url> <action>`: Mock network requests
- `console`: Access console messages
- `run-code <func>`: Execute arbitrary Playwright code

### Session Management Commands

- `list`: List active sessions
- `close-all`: Close all sessions
- `kill-all`: Kill all sessions

**Source References:**
- `skills/playwright-cli/SKILL.md`
- Wiki: [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
- DeepWiki search: [CLI commands](https://deepwiki.com/search/what-cli-commands-and-api-does_217802ef-1b35-4a8f-9a67-b5fe32955eb7)

---

## 4. Web Browsing/Fetching Capabilities

### Web Scraping and Data Extraction

Yes, Playwright CLI can be used for web scraping, page fetching, and web searching through browser automation.

#### Core Web Browsing Features

1. **Page Navigation**
   - Open browsers and navigate to URLs: `playwright-cli open [url]` and `playwright-cli goto <url>`
   - Support for Chromium, Firefox, WebKit browsers
   - Headless mode (default) or headed mode with `--headed` flag

2. **Session Management for Scraping**
   - Persistent sessions maintain cookies and storage state
   - Named sessions (`-s=`) for concurrent scraping or isolated scenarios
   - Useful for maintaining authentication states across requests

3. **Page Interaction**
   - Interact with elements: `click`, `fill`, `type`, `check`, `hover`, `select`
   - Element references from snapshots (e.g., `e1`, `e2`)
   - Tab management for multi-page scraping

#### Data Extraction Methods

1. **HTML Content Retrieval**
   ```bash
   playwright-cli run-code "async page => { return await page.content(); }"
   ```

2. **JavaScript Evaluation**
   ```bash
   playwright-cli eval <func> [ref]
   ```
   Evaluate JavaScript expressions on page or specific elements

3. **Custom Scraping Scripts**
   Use `run-code` command to execute complex Playwright scripts:
   ```bash
   playwright-cli run-code "async page => {
     const products = await page.evaluate(() => {
       return Array.from(document.querySelectorAll('.product')).map(p => ({
         name: p.querySelector('.name').textContent,
         price: p.querySelector('.price').textContent
       }));
     });
     return products;
   }"
   ```

4. **Snapshots for Element Discovery**
   After each command, CLI provides snapshots with:
   - Current URL
   - Page title
   - Element references for further interaction

5. **Screenshots and PDF Export**
   - Capture visual artifacts of pages
   - Export pages as PDFs for archival

6. **Network Request Control**
   - Mock network requests with `route` command
   - Control data fetched by browser during scraping

#### Use Cases for Web Scraping

- **Dynamic Content**: Handle JavaScript-rendered content
- **Form Submission**: Automate form filling and submission
- **Authentication**: Maintain login states across scraping sessions
- **Multi-page Navigation**: Navigate through paginated results
- **Interactive Elements**: Click buttons, expand sections before scraping
- **Screenshot Documentation**: Capture visual states of pages

**Source References:**
- README.md
- Wiki: [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
- DeepWiki search: [Web scraping capabilities](https://deepwiki.com/search/can-playwright-cli-be-used-for_c2ea5019-8c44-41d2-bd7b-93e7998300e5)

---

## 5. MCP Integration

### Relationship with Model Context Protocol

**Key Finding**: Playwright CLI is positioned as an **alternative to MCP**, not an implementation of it.

#### Playwright CLI vs. Playwright MCP

**Playwright CLI (`@playwright/cli`)**:
- Token-efficient CLI-based workflow
- Designed for high-throughput coding agents
- Avoids large tool schemas and verbose accessibility trees
- Best for agents that need efficient browser automation

**Playwright MCP** (separate project at `microsoft/playwright-mcp`):
- Full MCP protocol implementation
- Relevant for specialized agentic loops
- Requires persistent state and rich introspection
- Designed for iterative reasoning over page structure
- Better for exploratory automation, self-healing tests, or long-running autonomous workflows

#### MCP-Related Configuration

Despite being an alternative to MCP, Playwright CLI includes MCP-aware configuration:

**Environment Variables** (prefixed with `PLAYWRIGHT_MCP_`):
- `PLAYWRIGHT_MCP_ALLOWED_HOSTS`: Control allowed hosts
- `PLAYWRIGHT_MCP_CDP_ENDPOINT`: Chrome DevTools Protocol endpoint
- `PLAYWRIGHT_MCP_SAVE_SESSION`: Session persistence
- `PLAYWRIGHT_MCP_BROWSER`: Browser type
- `PLAYWRIGHT_MCP_HEADLESS`: Headless mode
- `PLAYWRIGHT_MCP_OUTPUT_DIR`: Output directory path
- `PLAYWRIGHT_MCP_CONFIG`: Configuration file path

#### Source Code Location

The Playwright CLI sources are located within the Playwright monorepo at:
- **Path**: `packages/playwright/src/mcp/terminal/`
- **Repository**: `https://github.com/microsoft/playwright`

This indicates that `playwright-cli` is a component within a broader MCP-related structure, even though it serves as a standalone alternative to full MCP integration.

#### When to Use Each

**Use Playwright CLI when:**
- Building high-throughput coding agents
- Token efficiency is critical
- Simple command-based automation is sufficient
- No need for persistent browser context

**Use Playwright MCP when:**
- Implementing specialized agentic loops
- Need persistent state across operations
- Require rich introspection of page structure
- Building self-healing tests or exploratory automation
- Long-running autonomous workflows

**Source References:**
- Wiki: [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
- Wiki: [Development (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#7)
- README.md
- DeepWiki search: [MCP integration](https://deepwiki.com/search/does-playwright-cli-support-mc_bf2568c3-0422-4568-bbae-6e274786b302)

### Playwright MCP Server Integration

From the broader Playwright ecosystem research, Playwright provides MCP servers:

1. **Browser Interaction MCP Server**
   - Command: `npx playwright run-mcp-server`
   - Provides browser interaction capabilities over MCP

2. **Test Runner MCP Server**
   - Command: `npx playwright run-test-mcp-server`
   - Allows interaction with Playwright test runner over MCP

3. **Playwright Test Agents**
   - 🎭 **planner**: Explores app and generates test plans
   - 🎭 **generator**: Converts plans to Playwright Test files
   - 🎭 **healer**: Executes tests and auto-repairs failures
   - Initialize with: `npx playwright init-agents`
   - Supports providers: VSCode, Claude, OpenCode, Copilot

**Source References:**
- `microsoft/playwright` repository
- DeepWiki search: [MCP best practices](https://deepwiki.com/search/what-are-the-best-practices-fo_50c91c3c-4f41-4d2b-b8ea-7407d9455c5b)

---

## 6. Binary Distribution

### Current Distribution Model

**Playwright CLI is NOT available as a standalone binary.** It is distributed exclusively as an npm package.

#### Distribution Details

- **Package Name**: `@playwright/cli`
- **Entry Point**: `playwright-cli.js` (Node.js script)
- **Execution Method**: Requires Node.js runtime
- **Installation**: Via npm (global or local)

#### Architecture

The `package.json` defines:
```json
{
  "bin": {
    "playwright-cli": "playwright-cli.js"
  }
}
```

The `playwright-cli.js` file is a Node.js script that requires `playwright/lib/cli/client/program`, meaning it depends on the main Playwright library's CLI infrastructure.

#### Bundling as Executable

**Current Status**: The provided codebase does not contain information or mechanisms for bundling Playwright CLI as a standalone executable.

**Potential Approaches** (not currently implemented):
- Tools like `pkg`, `nexe`, or `caxa` could theoretically bundle Node.js apps as executables
- Would need to bundle Node.js runtime, npm packages, and browser binaries
- Browser binaries alone are several hundred MB per browser
- No official support or documentation for this approach

#### Why No Standalone Binary?

1. **Browser Dependencies**: Requires browser binaries (Chromium, Firefox, WebKit)
2. **Node.js Runtime**: Built on Node.js infrastructure
3. **Dynamic Updates**: npm allows easy updates and version management
4. **Size Constraints**: Browser binaries make distribution package very large

**Source References:**
- `package.json` in repository
- `playwright-cli.js` entry point
- Wiki: [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
- DeepWiki search: [Binary distribution](https://deepwiki.com/search/can-playwright-cli-be-distribu_b6e90084-e97d-432b-b71d-6259e5b16d51)

---

## 7. Dependencies

### Runtime Dependencies

Playwright CLI has minimal runtime dependencies:

**Direct Dependencies** (from `package.json`):
1. **`playwright`**: The core Playwright library (main dependency)
2. **`minimist`**: Command-line argument parser

### Browser Installation

**Key Feature**: Playwright CLI does **NOT** require browsers to be installed separately.

#### Automatic Browser Management

When you install Playwright:
- Browser binaries are automatically downloaded (Chromium, Firefox, WebKit)
- Browsers are managed by Playwright itself
- Default location: `~/.cache/ms-playwright/` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright\` (Windows)

#### Browser Selection

Use `--browser` flag to specify browser:
```bash
playwright-cli open --browser=chrome    # Uses Chromium
playwright-cli open --browser=firefox   # Uses Firefox
playwright-cli open --browser=webkit    # Uses WebKit
playwright-cli open --browser=msedge    # Uses MS Edge
```

#### Browser Installation Commands

From main Playwright library:
```bash
# Install all browsers
npx playwright install

# Install specific browser
npx playwright install chromium
npx playwright install firefox
npx playwright install webkit

# Install browser dependencies (Linux only)
npx playwright install-deps
```

### Development Dependencies

For repository maintenance (not runtime):
- TypeScript tooling
- Linting tools
- Testing frameworks
- Build scripts

### Deprecated Package Note

There's a separate deprecated `playwright-cli` package with:
- **No functional dependencies**
- Acts only as redirection mechanism
- Redirects to `npx playwright`

**Source References:**
- `package.json` in repository
- Wiki: [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
- Wiki: [Skills Maintenance (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#7.2)
- DeepWiki search: [Dependencies](https://deepwiki.com/search/what-are-the-runtime-dependenc_7063bd6b-fbb0-403e-9a70-f4210d1df406)

---

## 8. Configuration

Playwright CLI can be configured through three complementary methods:

### 1. Command-Line Flags

#### Browser and Display Options

| Flag | Purpose | Example |
|------|---------|---------|
| `--browser` | Specify browser engine | `--browser=chrome`, `--browser=firefox`, `--browser=webkit`, `--browser=msedge` |
| `--headed` | Run with visible browser window | `playwright-cli open --headed https://example.com` |
| `--persistent` | Save browser profile to disk | `playwright-cli open --persistent` |
| `--profile=<path>` | Custom profile directory | `--profile=/path/to/profile` |

#### Session Management

| Flag | Purpose | Example |
|------|---------|---------|
| `-s=<name>` | Named session for isolation | `playwright-cli -s=mysession open https://example.com` |
| `--config` | Load configuration file | `--config path/to/config.json` |

### 2. Environment Variables

All environment variables use the `PLAYWRIGHT_MCP_` prefix:

#### Core Settings

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_CLI_SESSION` | Default session name |
| `PLAYWRIGHT_MCP_BROWSER` | Browser type (chrome, firefox, webkit) |
| `PLAYWRIGHT_MCP_HEADLESS` | Run in headless mode |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | Path for output files |
| `PLAYWRIGHT_MCP_CONFIG` | Configuration file path |
| `PLAYWRIGHT_MCP_ALLOWED_HOSTS` | Control allowed hosts |
| `PLAYWRIGHT_MCP_CDP_ENDPOINT` | Chrome DevTools Protocol endpoint |
| `PLAYWRIGHT_MCP_SAVE_SESSION` | Session persistence setting |

### 3. Configuration File

**Default Location**: `.playwright/cli.config.json`

**Schema** (JSON format):

```json
{
  "browser": {
    "browserName": "chromium",  // or "firefox", "webkit"
    "isolated": true,            // in-memory profile
    "userDataDir": "/path/to/profile",  // persistent profile
    "launchOptions": {},         // Playwright launch options
    "contextOptions": {},        // Playwright context options
    "cdpEndpoint": "ws://...",   // CDP endpoint
    "remoteEndpoint": "ws://...", // Remote browser endpoint
    "initPage": "https://...",   // Initial page to open
    "initScript": "code..."      // Script to run on init
  },
  "video": {
    "saveVideo": true,
    "width": 1280,
    "height": 720
  },
  "output": {
    "outputDir": "./output",     // Directory for output files
    "outputMode": "file"         // "file" or "stdout"
  },
  "console": {
    "level": "error"             // "error", "warning", "log", "info", "debug"
  },
  "network": {
    "allowedOrigins": ["https://example.com"],
    "blockedOrigins": ["https://ads.com"]
  },
  "timeouts": {
    "action": 30000,             // Action timeout in ms
    "navigation": 30000          // Navigation timeout in ms
  },
  "fileAccess": {
    "allowUnrestrictedFileAccess": false
  },
  "codegen": {
    "codegen": "typescript"      // "typescript" or "none"
  }
}
```

#### Configuration File Sections

1. **Browser Settings**
   - Browser engine selection
   - Profile management (in-memory vs persistent)
   - Launch and context options
   - Remote browser connections

2. **Video Recording**
   - Enable/disable recording
   - Resolution settings

3. **Output Configuration**
   - Directory for artifacts
   - Output mode (file or stdout)

4. **Console Filtering**
   - Control console message levels

5. **Network Control**
   - Allowed/blocked origins
   - Network request filtering

6. **Timeouts**
   - Action timeouts
   - Navigation timeouts

7. **File Access**
   - Unrestricted file upload permissions

8. **Code Generation**
   - Language for generated code

### Configuration Precedence

When multiple configuration sources are present:
1. Command-line flags (highest priority)
2. Environment variables
3. Configuration file
4. Default values (lowest priority)

**Source References:**
- README.md
- `skills/playwright-cli/SKILL.md`
- Wiki: [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
- DeepWiki search: [Configuration](https://deepwiki.com/search/how-is-playwright-cli-configur_8980af74-0834-485d-b246-1a80632db433)

---

## 9. Usage as a Tool for AI Agents

### Design Philosophy

**Playwright CLI is explicitly designed for coding agents and AI assistants**, emphasizing token-efficient workflows.

#### Why Token Efficiency Matters

- Avoids loading large tool schemas into model context
- Eliminates verbose accessibility trees
- Reduces context usage for high-throughput agents
- Faster decision-making for AI agents

### Installing SKILLS for AI Agents

AI agents can install SKILLS documentation locally:

```bash
playwright-cli install --skills
```

**What This Does:**
- Generates skill documentation in `.claude/skills/`
- Synchronizes to `skills/playwright-cli/`
- Enables token-efficient AI agent integration

### The Snapshot System

**Core Concept**: After each command, Playwright CLI outputs the current browser state as a snapshot.

#### Element References

Snapshots contain **element references** (e.g., `e1`, `e2`, `e3`):

```yaml
# Example snapshot output (YAML format)
url: https://example.com
title: Example Domain
elements:
  - ref: e1
    tag: button
    text: "Click Me"
    role: button
  - ref: e2
    tag: input
    type: text
    placeholder: "Enter email"
  - ref: e3
    tag: a
    text: "Learn More"
    href: "/about"
```

#### Using Element References

AI agents use these references in subsequent commands:

```bash
# Click the button
playwright-cli click e1

# Fill the input field
playwright-cli fill e2 "user@example.com"

# Click the link
playwright-cli click e3
```

#### Snapshot Storage

- **Format**: YAML
- **Default Location**: `.playwright-cli/` directory
- **Naming**: Timestamped files
- **Custom Names**: Use `--filename` flag

**Example:**
```bash
playwright-cli snapshot --filename my-snapshot.yaml
```

### Session Management for AI Agents

#### 1. Default Sessions (In-Memory)

```bash
playwright-cli open https://example.com
playwright-cli fill e1 "username"
playwright-cli fill e2 "password"
playwright-cli click e3
```

State preserved between commands, lost on browser close.

#### 2. Persistent Sessions

```bash
playwright-cli open --persistent https://example.com
# Login and authenticate
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password"
playwright-cli click e3
# State saved to disk
```

On next run:
```bash
playwright-cli open --persistent
# Already logged in!
```

#### 3. Named Sessions (Isolation)

```bash
# Session 1: User A
playwright-cli -s=userA open https://app.com
playwright-cli -s=userA fill e1 "userA@example.com"

# Session 2: User B (different browser instance)
playwright-cli -s=userB open https://app.com
playwright-cli -s=userB fill e1 "userB@example.com"
```

Or using environment variable:
```bash
export PLAYWRIGHT_CLI_SESSION=userA
playwright-cli open https://app.com
```

### AI Agent Workflow Patterns

#### Pattern 1: Simple Navigation and Interaction

```bash
# 1. Open browser and navigate
playwright-cli open https://example.com

# 2. Take snapshot to get element references
playwright-cli snapshot

# 3. Agent analyzes snapshot, identifies elements

# 4. Interact with elements
playwright-cli click e5
playwright-cli fill e8 "search query"
playwright-cli press Enter

# 5. Take screenshot for verification
playwright-cli screenshot
```

#### Pattern 2: Data Extraction with run-code

```bash
# Navigate to page
playwright-cli goto https://products.example.com

# Extract data with custom code
playwright-cli run-code "async page => {
  const products = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.product')).map(p => ({
      name: p.querySelector('.name').textContent,
      price: p.querySelector('.price').textContent,
      image: p.querySelector('img').src
    }));
  });
  return products;
}"
```

#### Pattern 3: Multi-Step Authentication

```bash
# Open login page
playwright-cli open --persistent https://app.com/login

# Fill credentials
playwright-cli snapshot
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password"
playwright-cli click e3

# Save authenticated state
playwright-cli run-code "async page => {
  await page.context().storageState({ path: 'auth.json' });
}"

# Later: Load authenticated state
playwright-cli run-code "async page => {
  await page.context().addCookies(
    JSON.parse(require('fs').readFileSync('auth.json')).cookies
  );
}"
```

#### Pattern 4: Form Automation

```bash
playwright-cli open https://forms.example.com
playwright-cli snapshot

# Fill multi-field form
playwright-cli fill e1 "John"
playwright-cli fill e2 "Doe"
playwright-cli fill e3 "john@example.com"
playwright-cli select e4 "United States"
playwright-cli check e5
playwright-cli click e6
```

### Advanced Agent Capabilities

#### 1. Geolocation and Permissions

```bash
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ 
    latitude: 37.7749, 
    longitude: -122.4194 
  });
}"
```

#### 2. Media Emulation

```bash
playwright-cli run-code "async page => {
  await page.emulateMedia({ colorScheme: 'dark' });
}"
```

#### 3. File Downloads

```bash
playwright-cli run-code "async page => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('a.download-link')
  ]);
  await download.saveAs('./downloaded-file.pdf');
  return download.suggestedFilename();
}"
```

#### 4. Clipboard Operations

```bash
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['clipboard-read']);
  return await page.evaluate(() => navigator.clipboard.readText());
}"
```

#### 5. Error Handling

```bash
playwright-cli run-code "async page => {
  try {
    await page.click('.maybe-missing', { timeout: 1000 });
    return 'clicked';
  } catch (e) {
    return 'element not found';
  }
}"
```

### Best Practices for AI Agents Using Playwright CLI

From Playwright MCP documentation (applicable to CLI):

1. **Avoid Improvising**: Follow directives strictly
2. **Use Clear Assertions**: Validate expected behavior
3. **Leverage Reliable Locators**: Use element references from snapshots
4. **Use Local Variables**: For repeated locators
5. **Leverage Auto-Waiting**: Playwright includes built-in waiting
6. **Avoid Explicit Waits**: Don't use `waitForLoadState()`, `waitForNavigation()`, or `waitForTimeout()`
7. **Avoid `page.evaluate()`**: Use higher-level Playwright APIs when possible
8. **Prefer Locator API**: Provides lazy evaluation and auto-waiting

### Token Efficiency Tips

1. **Use Snapshots Wisely**: Only take snapshots when needed
2. **Element References**: Reuse references instead of re-snapshotting
3. **Batch Operations**: Chain commands when possible
4. **Session Management**: Use persistent sessions to avoid re-authentication
5. **Custom Code**: Use `run-code` for complex operations to reduce command count

### Monitoring Agent Progress

Visual dashboard for observing agent activity:

```bash
playwright-cli show
```

This provides a monitoring interface for active browser sessions.

**Source References:**
- README.md
- `skills/playwright-cli/SKILL.md`
- Wiki: [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
- Wiki: [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
- DeepWiki searches:
  - [AI agent usage](https://deepwiki.com/search/is-there-documentation-about-u_1507c42a-4898-4d43-9143-c96d5aa27b24)
  - [Snapshot system](https://deepwiki.com/search/what-is-the-snapshot-system-in_d97ea657-6eb0-42d5-909d-2ac8dda6de38)
  - [run-code command](https://deepwiki.com/search/what-is-the-runcode-command-in_7af9b5d5-54c2-4561-b726-779c8d4ad75b)

---

## 10. Package Clarifications

### Understanding the Package Ecosystem

There are **two separate packages** with similar names:

#### 1. `@playwright/cli` (Active)

**Status**: ✅ **Actively Maintained**

- **npm Package**: `@playwright/cli`
- **Purpose**: CLI for coding agents
- **Location**: Within Playwright monorepo at `packages/playwright/src/mcp/terminal/`
- **Repository**: This is what `microsoft/playwright-cli` repository documents
- **Installation**: `npm install -g @playwright/cli@latest`
- **Execution**: `playwright-cli <command>`

#### 2. `playwright-cli` (Deprecated)

**Status**: ⚠️ **Deprecated - Redirection Only**

- **npm Package**: `playwright-cli` (without `@playwright/` scope)
- **Purpose**: Redirects to main Playwright CLI
- **Behavior**: Outputs error message and exits
- **Message**: "playwright-cli has moved to playwright. Use npx playwright instead."
- **Installation**: ❌ Not recommended
- **Execution**: Redirects to `npx playwright`

### The Confusion

The `microsoft/playwright-cli` repository:
- Documents the **active** `@playwright/cli` package
- Also contains the **deprecated** `playwright-cli` redirection package
- Both exist in the same repository but serve different purposes

### Relationship to Main Playwright

```
microsoft/playwright (Main Repository)
├── packages/playwright/
│   ├── src/mcp/terminal/  ← Source of @playwright/cli
│   └── lib/cli/           ← Main Playwright CLI (npx playwright)
└── ...

microsoft/playwright-cli (Distribution Repository)
├── @playwright/cli        ← Active CLI for agents (documented here)
└── playwright-cli         ← Deprecated redirection package
```

### Which Should You Use?

**For AI Agents and Coding Automation:**
```bash
npm install -g @playwright/cli@latest
playwright-cli --help
```

**For General Playwright Use:**
```bash
npm install -g playwright
npx playwright --help
```

**Key Differences:**

| Feature | `@playwright/cli` | `npx playwright` |
|---------|------------------|------------------|
| **Purpose** | Token-efficient agent automation | Full Playwright functionality |
| **Target Audience** | AI agents, coding agents | Developers, testers |
| **Output Format** | Snapshots with element refs | Standard CLI output |
| **SKILLS Support** | Yes (`--skills` flag) | No |
| **Test Runner** | No | Yes |
| **Code Generation** | Via `run-code` | Built-in codegen |
| **Inspector** | Via `show` command | Full inspector UI |

**Source References:**
- Wiki: [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
- `playwright-cli.js` in repository
- `package.json`
- DeepWiki search: [@playwright/cli package](https://deepwiki.com/search/what-is-playwrightcli-package_2a170c2e-4ae5-48e4-936e-d79926678fd1)

---

## 11. Complete Command Reference

### Session Management

```bash
# List all active sessions
playwright-cli list

# Open browser with default session
playwright-cli open [url]

# Named session
playwright-cli -s=mysession open [url]

# Persistent session (saves to disk)
playwright-cli open --persistent [url]

# Custom profile directory
playwright-cli open --persistent --profile=/path/to/profile [url]

# Close all sessions
playwright-cli close-all

# Kill all sessions forcefully
playwright-cli kill-all
```

### Navigation

```bash
# Navigate to URL
playwright-cli goto <url>

# Go back
playwright-cli go-back

# Go forward
playwright-cli go-forward

# Reload page
playwright-cli reload

# Close current page
playwright-cli close
```

### Element Interaction

```bash
# Take snapshot to get element references
playwright-cli snapshot
playwright-cli snapshot --filename custom.yaml

# Click element
playwright-cli click <ref>
playwright-cli click <ref> right  # right-click
playwright-cli click <ref> middle  # middle-click

# Double-click
playwright-cli dblclick <ref>

# Fill input field
playwright-cli fill <ref> "text"

# Type text (into focused element)
playwright-cli type "text"

# Hover over element
playwright-cli hover <ref>

# Drag and drop
playwright-cli drag <startRef> <endRef>

# Select dropdown option
playwright-cli select <ref> "value"

# Check/uncheck
playwright-cli check <ref>
playwright-cli uncheck <ref>

# Upload file
playwright-cli upload <file>
```

### Keyboard and Mouse

```bash
# Keyboard
playwright-cli press <key>
playwright-cli keydown <key>
playwright-cli keyup <key>

# Mouse
playwright-cli mousemove <x> <y>
playwright-cli mousedown [button]
playwright-cli mouseup [button]
playwright-cli mousewheel <dx> <dy>
```

### JavaScript Evaluation

```bash
# Evaluate JavaScript on page
playwright-cli eval "() => document.title"

# Evaluate on specific element
playwright-cli eval "el => el.textContent" <ref>

# Execute custom Playwright code
playwright-cli run-code "async page => {
  return await page.title();
}"
```

### Dialogs

```bash
# Accept dialog
playwright-cli dialog-accept

# Accept with prompt text
playwright-cli dialog-accept "response text"

# Dismiss dialog
playwright-cli dialog-dismiss
```

### Window Management

```bash
# Resize window
playwright-cli resize <width> <height>
```

### Tab Management

```bash
# List tabs
playwright-cli tab-list

# Create new tab
playwright-cli tab-new [url]

# Close tab by index
playwright-cli tab-close <index>

# Select tab by index
playwright-cli tab-select <index>
```

### Storage Management

```bash
# Storage state
playwright-cli state-save [filename]
playwright-cli state-load <filename>

# Cookies
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get <name>
playwright-cli cookie-set <name> <value>
playwright-cli cookie-delete <name>

# LocalStorage
playwright-cli localstorage-list
playwright-cli localstorage-get <key>
playwright-cli localstorage-set <key> <value>
playwright-cli localstorage-delete <key>

# SessionStorage
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get <key>
playwright-cli sessionstorage-set <key> <value>
playwright-cli sessionstorage-delete <key>
```

### Network

```bash
# Mock network request
playwright-cli route <url-pattern> <action>

# Console messages
playwright-cli console
```

### Artifacts

```bash
# Screenshot
playwright-cli screenshot
playwright-cli screenshot <ref>  # specific element

# PDF
playwright-cli pdf
```

### Monitoring

```bash
# Show visual dashboard
playwright-cli show
```

### Configuration

```bash
# Use configuration file
playwright-cli --config path/to/config.json <command>

# Browser selection
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge

# Headed mode
playwright-cli open --headed
```

### SKILLS Installation

```bash
# Install SKILLS documentation for AI agents
playwright-cli install --skills
```

---

## 12. Key Takeaways for Implementation

### For AI Agent Integration

1. **Token Efficiency**: Playwright CLI is specifically designed to minimize token usage for AI agents
2. **Snapshot-Based**: Use the snapshot system for element discovery and interaction
3. **Session Isolation**: Use named sessions for concurrent operations or user isolation
4. **Custom Code**: Leverage `run-code` for complex operations not covered by built-in commands
5. **Auto-Waiting**: Playwright includes built-in waiting - avoid explicit waits

### For Web Scraping Projects

1. **Dynamic Content**: Perfect for JavaScript-rendered sites
2. **Authentication**: Persistent sessions maintain login states
3. **Multi-Page**: Tab management for parallel scraping
4. **Data Extraction**: Use `run-code` with `page.evaluate()` for complex extraction
5. **Network Control**: Mock or block requests for efficiency

### For Browser Automation

1. **Cross-Browser**: Support for Chromium, Firefox, WebKit, MS Edge
2. **Headless Default**: Runs without UI by default, use `--headed` for debugging
3. **State Management**: Save/load storage states for workflow continuation
4. **Artifacts**: Screenshots and PDFs for documentation

### Limitations

1. **No Standalone Binary**: Requires Node.js runtime
2. **Large Installation**: Browser binaries add significant size
3. **Not MCP Protocol**: Alternative to MCP, not an implementation
4. **CLI Only**: No programmatic API (use main Playwright library for that)

### When to Use Playwright CLI vs Main Playwright

**Use `@playwright/cli` when:**
- Building AI agents that need browser automation
- Token efficiency is critical
- Need snapshot-based element references
- Want CLI-based workflow

**Use main Playwright library when:**
- Writing tests with Playwright Test
- Need programmatic API
- Building complex applications
- Want full test runner features

---

## 13. Additional Resources

### Documentation Links

- **DeepWiki Search Results**:
  - [What is Playwright CLI](https://deepwiki.com/search/what-is-playwright-cli-what-is_7e400251-eff1-4a62-b375-c1b75f14155f)
  - [Installation Methods](https://deepwiki.com/search/how-do-you-install-playwright_93627ae0-c074-4105-8518-239fa410e4fd)
  - [CLI Commands](https://deepwiki.com/search/what-cli-commands-and-api-does_217802ef-1b35-4a8f-9a67-b5fe32955eb7)
  - [Web Scraping](https://deepwiki.com/search/can-playwright-cli-be-used-for_c2ea5019-8c44-41d2-bd7b-93e7998300e5)
  - [MCP Integration](https://deepwiki.com/search/does-playwright-cli-support-mc_bf2568c3-0422-4568-bbae-6e274786b302)
  - [Binary Distribution](https://deepwiki.com/search/can-playwright-cli-be-distribu_b6e90084-e97d-432b-b71d-6259e5b16d51)
  - [Dependencies](https://deepwiki.com/search/what-are-the-runtime-dependenc_7063bd6b-fbb0-403e-9a70-f4210d1df406)
  - [Configuration](https://deepwiki.com/search/how-is-playwright-cli-configur_8980af74-0834-485d-b246-1a80632db433)
  - [AI Agent Usage](https://deepwiki.com/search/is-there-documentation-about-u_1507c42a-4898-4d43-9143-c96d5aa27b24)
  - [Package Clarification](https://deepwiki.com/search/what-is-playwrightcli-package_2a170c2e-4ae5-48e4-936e-d79926678fd1)
  - [Snapshot System](https://deepwiki.com/search/what-is-the-snapshot-system-in_d97ea657-6eb0-42d5-909d-2ac8dda6de38)
  - [Run-code Command](https://deepwiki.com/search/what-is-the-runcode-command-in_7af9b5d5-54c2-4561-b726-779c8d4ad75b)
  - [MCP Best Practices](https://deepwiki.com/search/what-are-the-best-practices-fo_50c91c3c-4f41-4d2b-b8ea-7407d9455c5b)

- **Repository Links**:
  - [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) - Distribution repository
  - [microsoft/playwright](https://github.com/microsoft/playwright) - Main Playwright repository
  - [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - Playwright MCP Server
  - [Source Code Location](https://github.com/microsoft/playwright/tree/main/packages/playwright/src/mcp/terminal) - CLI sources in monorepo

- **Wiki Pages**:
  - [Overview (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#1)
  - [Getting Started (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#2)
  - [Development (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#7)
  - [Skills Maintenance (microsoft/playwright-cli)](/wiki/microsoft/playwright-cli#7.2)
  - [Playwright Overview (microsoft/playwright)](/wiki/microsoft/playwright#1)
  - [Locator and Element Interactions (microsoft/playwright)](/wiki/microsoft/playwright#3.3)

### Key Files Referenced

- `README.md` - Main documentation
- `skills/playwright-cli/SKILL.md` - SKILLS documentation for agents
- `package.json` - Package configuration
- `playwright-cli.js` - CLI entry point
- `index.js` - Deprecated package redirection
- `.playwright/cli.config.json` - Configuration file schema

---

## 14. Conclusion

Playwright CLI (`@playwright/cli`) is a powerful, token-efficient tool specifically designed for AI agents and coding automation. Its snapshot-based approach to element interaction, combined with comprehensive browser automation capabilities, makes it ideal for:

- **AI-Driven Browser Automation**: Token-efficient command-based workflows
- **Web Scraping**: Dynamic content handling with persistent sessions
- **Form Automation**: Multi-step form filling and submission
- **Data Extraction**: Custom JavaScript execution for complex extraction
- **Testing Automation**: Browser interaction for test scenarios

The CLI's design philosophy prioritizes efficiency for AI agents while maintaining the full power of Playwright's browser automation capabilities. Its clear separation from Playwright MCP provides options for different use cases: CLI for high-throughput agents, MCP for stateful exploratory workflows.

For AI agents building browser automation capabilities, Playwright CLI offers a well-documented, actively maintained, and purpose-built solution with comprehensive command coverage and flexible configuration options.

---

**Research Date**: February 25, 2026  
**Research Method**: DeepWiki AI-powered repository analysis  
**Primary Repository**: microsoft/playwright-cli  
**Related Repositories**: microsoft/playwright, anthropics/anthropic-cookbook  
**Document Version**: 1.0
