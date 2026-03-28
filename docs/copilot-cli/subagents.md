# Custom agents configuration

Reference for configuring custom agents.

This reference article provides detailed configuration information for custom agents. For general information about creating custom agents, see [Creating custom agents for Copilot coding agent](/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents).

> \[!NOTE]
> Custom agents are in public preview for JetBrains IDEs, Eclipse, and Xcode, and subject to change.

## YAML frontmatter properties

The following table outlines the properties that you can configure for agent profiles in GitHub.com, the Copilot CLI, and supported IDEs (unless otherwise noted). Any environment-specific behavior is noted in the property description. The configuration file's name (minus `.md` or `.agent.md`) is used for deduplication between levels so that the lowest level configuration takes precedence.

<div class="ghd-tool rowheaders">

| Property                   | Type                                                     | Purpose                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                     | string                                                   | Display name for the custom agent. Optional.                                                                                                                                                                                                                                                                             |
| `description`              | **Required** string                                      | Description of the custom agent's purpose and capabilities                                                                                                                                                                                                                                                               |
| `target`                   | string                                                   | Target environment or context for the custom agent (`vscode` or `github-copilot`). If unset, defaults to both environments.                                                                                                                                                                                              |
| `tools`                    | list of strings, string                                  | List of tool names the custom agent can use. Supports both a comma separated string and yaml string array. If unset, defaults to all tools. See [Tools](#tools).                                                                                                                                                         |
| `model`                    | string                                                   | Model to use when this custom agent executes. If unset, inherits the default model.                                                                                                                                                                                                                                      |
| `disable-model-invocation` | boolean                                                  | Disables Copilot coding agent from automatically using this custom agent based on task context. When `true`, the agent must be manually selected. Setting `disable-model-invocation: true` is equivalent to `infer: false`. If both are set, `disable-model-invocation` takes precedence. If unset, defaults to `false`. |
| `user-invocable`           | boolean                                                  | Controls whether this custom agent can be selected by a user. When `false`, the agent cannot be manually selected and can only be accessed programmatically. If unset, defaults to `true`.                                                                                                                               |
| `infer`                    | boolean                                                  | **Retired**. Use `disable-model-invocation` and `user-invocable` instead. Enables Copilot coding agent to automatically use this custom agent based on task context. When `false`, the agent must be manually selected. If unset, defaults to `true`.                                                                    |
| `mcp-servers`              | object                                                   | Additional MCP servers and tools that should be used by the custom agent. **Not used in VS Code and other IDE custom agents.**                                                                                                                                                                                           |
| `metadata`                 | object consisting of a name and value pair, both strings | Allows annotation of the agent with useful data. **Not used in VS Code and other IDE custom agents.**                                                                                                                                                                                                                    |

</div>

Define the agent's behavior, expertise, and instructions in the Markdown content below the YAML frontmatter. The prompt can be a maximum of 30,000 characters.

> \[!NOTE]
>
> * The `argument-hint` and `handoffs` properties from VS Code and other IDE custom agents are currently not supported for Copilot coding agent on GitHub.com. They are ignored to ensure compatibility.
> * For more information on custom agent file structure in VS Code, see [Custom agents in VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-agents#_custom-agent-file-structure) in the VS Code documentation.

## Tools

The custom agent `tools` property controls which tools are available to your agent, including those from MCP servers.

Your custom agent will have access to MCP server tools that have been configured in both its agent profile and/or the repository settings. For more information on configuring MCP servers for coding agent in a repository, see [Extending GitHub Copilot coding agent with the Model Context Protocol (MCP)](/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp).

You can configure `tools` using the following approaches:

* **Enable all available tools**: Omit the `tools` property entirely or use `tools: ["*"]` to enable all available tools. This will include all MCP server tools configured in the agent profile and/or repository settings.
* **Enable specific tools**: Provide a list of specific tool names or aliases (for example, `tools: ["read", "edit", "search"]`) to enable only those tools. For available tool aliases, see [Tool aliases](#tool-aliases) below.
  * Note that if your repository has MCP servers configured, you can choose to make only specific tools from those servers available to your custom agent. Tool names from specific MCP servers can be prefixed with the server name followed by a `/`. For example, `some-mcp-server/some-tool`.
  * You can also explicitly enable all tools from a specific MCP server using `some-mcp-server/*`.
  * Tools from VS Code extensions can use the extension name as a proxy, like `azure.some-extension/some-tool`.
* **Disable all tools**: Use an empty list (`tools: []`) to disable all tools for the agent.

All unrecognized tool names are ignored, which allows product-specific tools to be specified in an agent profile without causing problems.

### Tool aliases

The following tool aliases are available for custom agents. All aliases are case insensitive:

| Primary alias | Compatible aliases                           | Coding agent mapping                                 | Purpose                                                                                                   |
| ------------- | -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `execute`     | `shell`, `Bash`, `powershell`                | Shell tools: `bash` or `powershell`                  | Execute a command in the appropriate shell for the operating system.                                      |
| `read`        | `Read`, `NotebookRead`                       | `view`                                               | Read file contents.                                                                                       |
| `edit`        | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | Edit tools: e.g. `str_replace`, `str_replace_editor` | Allow LLM to edit. Exact arguments can vary.                                                              |
| `search`      | `Grep`, `Glob`                               | `search`                                             | Search for files or text in files.                                                                        |
| `agent`       | `custom-agent`, `Task`                       | "Custom agent" tools                                 | Allows a different custom agent to be invoked to accomplish a task.                                       |
| `web`         | `WebSearch`, `WebFetch`                      | Currently not applicable for coding agent.           | Allows fetching content from URLs and performing a web search                                             |
| `todo`        | `TodoWrite`                                  | Currently not applicable for coding agent.           | Creates and manages structured task lists. Not supported in coding agent today, but supported by VS Code. |

### Tool names for "out-of-the-box" MCP servers

The following MCP servers are available out-of-box for Copilot coding agent and can be referenced using namespacing:

| MCP server name | Available tools                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`        | All read-only tools are available by default, but the token the server receives is scoped to the source repository. `github/*` includes all of them, or you can reference `github/<tool name>` where `<tool name>` is a value from the MCP server documentation.                                                                          |
| `playwright`    | All playwright tools are available by default, but the server is configured to only access localhost. `playwright/*` includes all of them, or you can reference `playwright/<tool name>` where `<tool name>` is a value from the MCP server documentation. By default the token it has access to is scoped to the source code repository. |

## MCP server configuration details

The following sample agent profile shows an agent with an MCP server and a secret configured. Additionally, only one tool from the MCP server has been enabled in the `tools` property in the YAML frontmatter:

```text
---
name: my-custom-agent-with-mcp
description: Custom agent description
tools: ['tool-a', 'tool-b', 'custom-mcp/tool-1']
mcp-servers:
  custom-mcp:
    type: 'local'
    command: 'some-command'
    args: ['--arg1', '--arg2']
    tools: ["*"]
    env:
      ENV_VAR_NAME: ${{ secrets.COPILOT_MCP_ENV_VAR_VALUE }}
---

Prompt with suggestions for behavior and output
```

The `mcp-servers` property in an agent profile is a YAML representation of the JSON configuration format used to configure MCP servers for Copilot coding agent.

Most sub-properties are the same as the JSON representation. The following sections describe changes from the initial implementation of MCP configuration in Copilot coding agent that are relevant to custom agents. For more information about the JSON configuration format, see [Extending GitHub Copilot coding agent with the Model Context Protocol (MCP)](/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp#writing-a-json-configuration-for-mcp-servers).

### MCP server type

For compatibility, the `stdio` type used by Claude Code and VS Code is mapped to coding agent's `local` type.

### MCP server environment variables and secrets

> \[!NOTE]
> If your MCP server requires secrets or environment variables, these must be configured in the Copilot environment in each repository where the custom agent will be used. For more information on setting up environment variables, see [Customizing the development environment for GitHub Copilot coding agent](/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment#setting-environment-variables-in-copilots-environment).

Custom agent MCP configuration supports the same environment variable and secret replacement capabilities as existing repository-level MCP configurations. Similar to repository-level configurations, secrets and variables can be sourced from the "copilot" environment in the repository's settings. The syntax for referencing these values has been expanded to support common patterns used in GitHub Actions and Claude Code.

Both the repository-level MCP JSON configuration and the custom agent YAML configuration support the following syntax patterns:

* `$COPILOT_MCP_ENV_VAR_VALUE` - Environment variable and header
* `${COPILOT_MCP_ENV_VAR_VALUE}` - Environment variable and header (Claude Code syntax)
* `${COPILOT_MCP_ENV_VAR_VALUE:-default}` - Environment variable and header with default

The custom agent YAML configuration supports the following additional syntax patterns:

* `${{ secrets.COPILOT_MCP_ENV_VAR_VALUE }}` - Environment variable and header
* `${{ vars.COPILOT_MCP_ENV_VAR_VALUE }}` - Environment variable and header

## Example agent profile configurations

The following examples demonstrate what an agent profile could look like for the common tasks of writing tests or planning the implementation of a project. For additional inspiration, see the [Custom agents](/en/copilot/tutorials/customization-library/custom-agents) examples in the customization library. You can also find more specific examples in the [awesome-copilot](https://github.com/github/awesome-copilot/tree/main/agents) community collection.

### Testing specialist

This example enables all tools by omitting the `tools` property.

```text copy
---
name: test-specialist
description: Focuses on test coverage, quality, and testing best practices without modifying production code
---

You are a testing specialist focused on improving code quality through comprehensive testing. Your responsibilities:

- Analyze existing tests and identify coverage gaps
- Write unit tests, integration tests, and end-to-end tests following best practices
- Review test quality and suggest improvements for maintainability
- Ensure tests are isolated, deterministic, and well-documented
- Focus only on test files and avoid modifying production code unless specifically requested

Always include clear test descriptions and use appropriate testing patterns for the language and framework.
```

### Implementation planner

This example only enables a subset of tools.

```text copy
---
name: implementation-planner
description: Creates detailed implementation plans and technical specifications in markdown format
tools: ["read", "search", "edit"]
---

You are a technical planning specialist focused on creating comprehensive implementation plans. Your responsibilities:

- Analyze requirements and break them down into actionable tasks
- Create detailed technical specifications and architecture documentation
- Generate implementation plans with clear steps, dependencies, and timelines
- Document API designs, data models, and system interactions
- Create markdown files with structured plans that development teams can follow

Always structure your plans with clear headings, task breakdowns, and acceptance criteria. Include considerations for testing, deployment, and potential risks. Focus on creating thorough documentation rather than implementing code.
```

## Processing of custom agents

### Custom agents names

In the case of naming conflicts, the lowest level configuration overrides higher-level configurations. This means that a repository-level agent would take precedence over an organization-level agent, and the organization-level agent would override an enterprise-level agent.

### Versioning

Custom agent versioning is based on Git commit SHAs for the agent profile file. This allows you to create branches or tags with different versions of custom agents as needed. When you assign a custom agent to a task, the custom agent will be instantiated using the latest version of the agent profile for that repository and branch. When the agent creates a pull request, interactions within the pull request use the same version of the custom agent for consistency.

### Tools processing

The `tools` list filters the set of tools that are made available to the agent - whether built-in or sourced from MCP servers. When you configure tools in your agent profile, the behavior depends on what you specify:

* If no tools are specified, all available tools are enabled
* An empty tools list (`tools: []`) disables all tools
* A specific list (`tools: [...]`) enables only those tools

### MCP server configurations

For MCP server configurations, there is a specific processing order that ensures proper override behavior: out-of-the-box MCP configurations (like the GitHub MCP) are processed first, followed by the custom agent MCP configuration, and finally MCP configurations specified through repository settings. This allows each level to override settings from the previous level as appropriate.

## Further reading

* [GitHub Copilot CLI](/en/copilot/how-tos/copilot-cli)
* [GitHub Copilot CLI command reference](/en/copilot/reference/copilot-cli-reference/cli-command-reference#custom-agents-reference)