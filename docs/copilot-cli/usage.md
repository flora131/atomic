# Using GitHub Copilot CLI

Learn how to use GitHub Copilot from the command line.

The command-line interface (CLI) for GitHub Copilot allows you to use Copilot directly from your terminal. For more information, see [About GitHub Copilot CLI](/en/copilot/concepts/agents/about-copilot-cli).

> \[!NOTE]
> GitHub Copilot CLI is in public preview with [data protection](https://gh.io/dpa) and subject to change.

## Prerequisite

Install Copilot CLI. See [Installing GitHub Copilot CLI](/en/copilot/how-tos/set-up/install-copilot-cli).

## Using Copilot CLI

1. In your terminal, navigate to a folder that contains code you want to work with.

2. Enter `copilot` to start Copilot CLI.

   Copilot will ask you to confirm that you trust the files in this folder.

   > \[!IMPORTANT]
   > During this GitHub Copilot CLI session, Copilot may attempt to read, modify, and execute files in and below this folder. You should only proceed if you trust the files in this location. For more information about trusted directories, see [About GitHub Copilot CLI](/en/copilot/concepts/agents/about-copilot-cli#trusted-directories).

3. Choose one of the options:

   **1. Yes, proceed**:

   Copilot can work with the files in this location for this session only.

   **2. Yes, and remember this folder for future sessions**:

   You trust the files in this folder for this and future sessions. You won't be asked again when you start Copilot CLI from this folder. Only choose this option if you are sure that it will always be safe for Copilot to work with files in this location.

   **3. No, exit (Esc)**:

   End your Copilot CLI session.

4. If you are not currently logged in to GitHub, you'll be prompted to use the `/login` slash command. Enter this command and follow the on-screen instructions to authenticate.

5. Enter a prompt in the CLI.

   This can be a simple chat question, or a request for Copilot to perform a specific task, such as fixing a bug, adding a feature to an existing application, or creating a new application.

   For some examples of prompts, see [About GitHub Copilot CLI](/en/copilot/concepts/agents/about-copilot-cli).

6. When Copilot wants to use a tool that could modify or execute files—for example, `touch`, `chmod`, `node`, or `sed`—it will ask you to approve the use of the tool.

   Choose one of the options:

   **1. Yes**:

   Allow Copilot to use this tool. The next time Copilot wants to use this tool, it will ask you to approve it again.

   **2. Yes, and approve TOOL for the rest of the running session**:

   Allow Copilot to use this tool—with any options—without asking again, for the rest of the currently running session. Any pending parallel permission requests of the same type will be auto-approved. You will have to approve the command again in future sessions.

   Choosing this option is useful for many tools—such as `chmod`—as it avoids you having to approve similar commands repeatedly in the same session. However, be aware of the security implications of this option. For example, choosing this option for the command `rm` would allow Copilot to delete any file in the current directory or its subdirectories without asking for your approval.

   **3. No, and tell Copilot what to do differently (Esc)**:

   Copilot will not run the command. Instead, it ends the current operation and awaits your next prompt. You can tell Copilot to continue the task but using a different approach.

   For example, if you ask Copilot to create a bash script but you do not want to use the script Copilot suggests, you can stop the current operation and enter a new prompt, such as: `Continue the previous task but include usage instructions in the script`.

   When you reject a tool permission request, you can also give Copilot inline feedback about the rejection so it can adapt its approach without stopping entirely.

## Permissions

Copilot CLI uses a permissions system to control access to paths and URLs. At times, path and URL permission checks utilize heuristic-based detection, which has limitations to be aware of.

### Path permissions

Path permissions control which directories and files Copilot can access. By default, Copilot CLI can access the current working directory, its subdirectories, and the system temp directory.

Path permissions apply to shell commands, file operations (create, edit, view), and search tools (such as `grep` and glob patterns). For shell commands, paths are heuristically extracted by tokenizing command text and identifying tokens that look like paths.

> \[!WARNING]
> Path detection for shell commands has limitations:
>
> * Paths embedded in complex shell constructs may not be detected.
> * Only a specific set of environment variables are expanded (`HOME`, `TMPDIR`, `PWD`, and similar). Custom variables like `$MY_PROJECT_DIR` are not expanded and may not be validated correctly.
> * Symlinks are resolved for existing files, but not for files being created.

To disable path verification, use the `--allow-all-paths` flag when starting Copilot CLI.

### URL permissions

URL permissions control which external URLs Copilot can access. By default, all URLs require approval before access is granted.

URL permissions apply to the `web_fetch` tool and a curated list of shell commands that access the network (such as `curl`, `wget`, and `fetch`). For shell commands, URLs are extracted using regex patterns.

> \[!WARNING]
> URL detection for shell commands has limitations:
>
> * URLs in file contents, config files, or environment variables read by commands are not detected.
> * Obfuscated URLs (such as split strings or escape sequences) may not be detected.
> * HTTP and HTTPS are treated as different protocols and require separate approval.

To disable URL verification, use the `--allow-all-urls` flag. To pre-approve specific domains, use `--allow-url <domain>` (for example, `--allow-url github.com`).

## Tips

Optimize your experience with Copilot CLI with the following tips.

### Stop a currently running operation

If you enter a prompt and then decide you want to stop Copilot from completing the task while it is still "Thinking," press <kbd>Esc</kbd>.

### Use plan mode

Plan mode lets you collaborate with Copilot on an implementation plan before any code is written. Press <kbd>Shift</kbd>+<kbd>Tab</kbd> to cycle in and out of plan mode.

### Steer the conversation while Copilot is thinking

You can interact with Copilot while it's thinking. Send follow-up messages to steer the conversation in a different direction, or queue additional instructions for Copilot to process after it finishes its current response.

### Include a specific file in your prompt

To add a specific file to your prompt, use `@` followed by the relative path to the file. For example: `Explain @config/ci/ci-required-checks.yml` or `Fix the bug in @src/app.js`. This adds the contents of the file to your prompt as context for Copilot.

When you start typing a file path, the matching paths are displayed below the prompt box. Use the arrow keys to select a path and press <kbd>Tab</kbd> to complete the path in your prompt.

### Work with files in a different location

To complete a task, Copilot may need to work with files that are outside the current working directory. If a prompt you have entered in an interactive session requires Copilot to modify a file outside the current location, it will ask you to approve access to the file's directory.

You can also add a trusted directory manually at any time by using the slash command:

```shell
/add-dir /path/to/directory
```

If all of the files you want to work with are in a different location, you can switch the current working directory without starting a new Copilot CLI session by using either the `/cwd` or `/cd` slash commands:

```shell
/cwd /path/to/directory
```

### Run shell commands

You can prepend your input with `!` to directly run shell commands, without making a call to the model.

```shell
!git clone https://github.com/github/copilot-cli
```

### Delegate tasks to Copilot coding agent

The delegate command lets you push your current session to Copilot coding agent on GitHub. This lets you hand off work while preserving all the context Copilot needs to complete your task.

You can delegate a task using the slash command, followed by a prompt:

```shell
/delegate complete the API integration tests and fix any failing edge cases
```

Alternatively, prefix a prompt with `&` to delegate it:

```shell
& complete the API integration tests and fix any failing edge cases
```

Copilot will ask to commit any of your unstaged changes as a checkpoint in a new branch it creates. Copilot coding agent will open a draft pull request, make changes in the background, and request a review from you.

Copilot will provide a link to the pull request and agent session on GitHub once the session begins.

### Resume an interactive session

You can use the `--resume` command line option or the `/resume` slash command to cycle through and resume local and remote interactive sessions, allowing you to pick up right where you left off with your existing context. You can kick off a Copilot coding agent session on GitHub, and then use GitHub Copilot CLI to bring that session to your local environment.

You can quickly resume the most recently closed local session by using the `--continue` command line option.

### Use custom instructions

You can enhance Copilot’s performance, by adding custom instructions to the repository you are working in. Custom instructions are natural language descriptions saved in Markdown files in the repository. They are automatically included in prompts you enter while working in that repository. This helps Copilot to better understand the context of your project and how to respond to your prompts.

Copilot CLI supports:

* Repository-wide instructions in the `.github/copilot-instructions.md` file.
* Path-specific instructions files: `.github/instructions/**/*.instructions.md`.
* Agent files such as `AGENTS.md`.

For more information, see [Adding repository custom instructions for GitHub Copilot](/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).

### Use custom agents

Custom agents are specialized versions of Copilot coding agent that you can tailor to your unique workflows, coding conventions, and use cases. Custom agents are defined using Markdown files, called agent profiles, that specify prompts, tools, and MCP servers.

GitHub Copilot CLI includes a default group of custom agents for common tasks:

| Agent       | Description                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore     | Performs quick codebase analysis, allowing you to ask questions about your code without adding to your main context.                                                       |
| Task        | Executes commands such as tests and builds, providing brief summaries on success and full output on failure.                                                               |
| Plan        | Analyzes dependencies and structure to create implementation plans, helping you to understand how to approach a complex feature or refactoring task before making changes. |
| Code-review | Reviews changes with a focus on surfacing only genuine issues, minimizing noise.                                                                                           |

When creating your own custom agents, Copilot CLI supports loading custom agents from the following locations:

| Type                                           | Location                                                                                 | Scope                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| User-level custom agent                        | local `~/.copilot/agents` directory                                                      | All projects                                                |
| Repository-level custom agent                  | `.github/agents` directory in your local and remote repositories                         | Current project                                             |
| Organization and Enterprise-level custom agent | `/agents` directory in the `.github-private` repository in an organization or enterprise | All projects under your organization and enterprise account |

In the case of naming conflicts, a system-level agent overrides a repository-level agent, and the repository-level agent would override an organization-level agent.

Custom agents can be used in three ways:

* Using the slash command in interactive mode to select from the list of available custom agents:

  ```shell
  /agent
  ```

* Calling out to custom agent directly in a prompt:

  ```shell
  Use the refactoring agent to refactor this code block
  ```

  Copilot will automatically infer the agent you want to use.

* Specifying the custom agent you want to use with the command-line option. For example:

  ```shell
  copilot --agent=refactor-agent --prompt "Refactor this code block"
  ```

For more information, see [Creating custom agents](/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents).

### Use skills

You can create skills to enhance the ability of Copilot to perform specialized tasks with instructions, scripts, and resources.

For more information, see [About Agent Skills](/en/copilot/concepts/agents/about-agent-skills).

### Add an MCP server

Copilot CLI comes with the GitHub MCP server already configured. This MCP server allows you to interact with resources on GitHub.com—for example, allowing you to merge pull requests from the CLI.

To extend the functionality available to you in Copilot CLI, you can add more MCP servers:

1. Use the following slash command:

   ```shell
   /mcp add
   ```

2. Fill in the details for the MCP server you want to add, using the <kbd>Tab</kbd> key to move between fields.

3. Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save the details.

Details of your configured MCP servers are stored in the `mcp-config.json` file, which is located, by default, in the `~/.copilot` directory. This location can be changed by setting the `XDG_CONFIG_HOME` environment variable. For information about the JSON structure of a server definition, see [Extending GitHub Copilot coding agent with the Model Context Protocol (MCP)](/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp#writing-a-json-configuration-for-mcp-servers).

### Context management

Copilot CLI provides several slash commands to help you monitor and manage your context window:

* `/usage`: Lets you view your session statistics, including:
  * The amount of premium requests used in the current session
  * The session duration
  * The total lines of code edited
  * A breakdown of token usage per model

* `/context`: Provides a visual overview of your current token usage

* `/compact`: Manually compresses your conversation history to free up context space

GitHub Copilot CLI automatically compresses your history in the background when your conversation approaches 95% of the token limit, without interrupting your workflow.

### Review code changes

You can use the `/review` slash command to have Copilot analyze code changes without leaving the CLI. This lets you get quick feedback on your changes prior to committing.

### Enable all permissions

For situations where you trust Copilot to run freely, you can use the `--allow-all` or `--yolo` flags to enable all permissions at once.

### Toggle reasoning visibility

Press <kbd>Ctrl</kbd>+<kbd>T</kbd> to show or hide the model's reasoning process while it generates a response. This setting persists across sessions, allowing you to observe how Copilot works through complex problems.

## Find out more

For a complete list of the command line options and slash commands that you can use with Copilot CLI, do one of the following:

* Enter `?` in the prompt box in an interactive session.
* Enter `copilot help` in your terminal.

For additional information use one of the following commands in your terminal:

* **Configuration settings**:

  `copilot help config`

  You can adjust the configuration settings by editing the `config.json` file, which is located, by default, in the `~/.copilot` directory. This location can be changed by setting the `XDG_CONFIG_HOME` environment variable.

* **Environment variables** that affect Copilot CLI:

  `copilot help environment`

* **Available logging levels**:

  `copilot help logging`

* **Permissions** for allowing or denying tool use:

  `copilot help permissions`

## Feedback

If you have any feedback about GitHub Copilot CLI, please let us know by using the `/feedback` slash command in an interactive session and choosing one of the options. You can complete a private feedback survey, submit a bug report, or suggest a new feature.