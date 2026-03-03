# Azure DevOps CLI Tooling Research

**Date**: 2026-03-03  
**Purpose**: Research Azure DevOps CLI tooling for coding agent workflows (similar to `gh` CLI or `sl` CLI)

## Summary

Azure DevOps provides multiple CLI and API options for automation:

1. **Azure CLI with DevOps Extension** (`az devops` and `az repos`) - Official Microsoft CLI tool
2. **azure-devops-node-api** - Official Node.js TypeScript client library  
3. **tfx-cli** - Team Foundation Extensions CLI for managing extensions
4. **azure-devops-mcp** - MCP server for AI agents (official Microsoft package)

The primary workflow uses `az repos pr create` for pull requests, which integrates with standard Git operations. Authentication uses Personal Access Tokens (PAT) or Azure Active Directory.

---

## 1. Azure CLI DevOps Extension (`az devops` and `az repos`)

### Overview
The Azure CLI DevOps extension provides command-line access to Azure DevOps services including repos, pipelines, boards, and artifacts.

**Official Documentation**:
- Main docs: https://learn.microsoft.com/en-us/cli/azure/devops
- Azure Repos commands: https://learn.microsoft.com/en-us/cli/azure/repos
- PR commands: https://learn.microsoft.com/en-us/cli/azure/repos/pr

### Installation

```bash
# Install Azure CLI (if not already installed)
# macOS
brew install azure-cli

# Windows
winget install Microsoft.AzureCLI

# Linux (Ubuntu/Debian)
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Install the DevOps extension
az extension add --name azure-devops
```

### Authentication

```bash
# Method 1: Personal Access Token (PAT)
export AZURE_DEVOPS_EXT_PAT=<your-pat-token>

# Method 2: Interactive login
az login

# Configure default organization and project
az devops configure --defaults organization=https://dev.azure.com/your-org project=your-project
```

### Key Commands

#### Repository Operations
```bash
# List repositories
az repos list --organization https://dev.azure.com/your-org --project your-project

# Show repository details
az repos show --repository my-repo

# Create a repository
az repos create --name my-new-repo

# List branches
az repos ref list --repository my-repo

# Create a branch
az repos ref create --name refs/heads/feature/my-branch --object-id <commit-sha> --repository my-repo
```

#### Pull Request Operations
```bash
# Create a pull request
az repos pr create \
  --repository my-repo \
  --source-branch feature/my-feature \
  --target-branch main \
  --title "My PR Title" \
  --description "PR description" \
  --work-items 1234 5678

# List pull requests
az repos pr list --repository my-repo --status active

# Show PR details
az repos pr show --id 123

# Update PR
az repos pr update --id 123 --title "Updated Title" --description "Updated description"

# Add reviewers
az repos pr reviewer add --id 123 --reviewers user@example.com team-name

# Set PR to auto-complete
az repos pr set-vote --id 123 --vote approve

# Complete (merge) a PR
az repos pr update --id 123 --status completed

# Abandon a PR
az repos pr update --id 123 --status abandoned

# Create PR with auto-complete
az repos pr create \
  --repository my-repo \
  --source-branch feature/my-feature \
  --target-branch main \
  --title "Auto-merge PR" \
  --auto-complete true \
  --delete-source-branch true
```

#### Policy and Status
```bash
# List policies
az repos policy list --repository-id <repo-id>

# Create PR comment
az repos pr policy list --id 123

# List PR work items
az repos pr work-item list --id 123
```

### Required Parameters for `az repos pr create`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--source-branch` or `-s` | Yes | Source branch name (e.g., `feature/my-feature`) |
| `--target-branch` or `-t` | No* | Target branch (defaults to default branch, usually `main`) |
| `--title` | No* | PR title (defaults to last commit message) |
| `--repository` or `-r` | No* | Repository name or ID (uses current repo if in a Git directory) |
| `--description` or `-d` | No | PR description |
| `--work-items` | No | Space-separated list of work item IDs |
| `--reviewers` | No | Space-separated list of reviewer email addresses or team names |
| `--auto-complete` | No | Set PR to auto-complete (true/false) |
| `--delete-source-branch` | No | Delete source branch after merge (true/false) |
| `--draft` | No | Create as draft PR (true/false) |

*Optional but commonly specified

### Authentication Setup

```bash
# Create Personal Access Token (PAT)
# 1. Go to https://dev.azure.com/{organization}/_usersSettings/tokens
# 2. Create new token with 'Code (Read & Write)' scope
# 3. Set environment variable
export AZURE_DEVOPS_EXT_PAT=your_pat_token_here

# Or use Azure DevOps login
az devops login --organization https://dev.azure.com/your-org
```

---

## 2. azure-devops-node-api (Node.js/TypeScript Client)

### Overview
Official Microsoft TypeScript/JavaScript client library for Azure DevOps REST APIs.

**Links**:
- NPM: https://www.npmjs.com/package/azure-devops-node-api
- GitHub: https://github.com/Microsoft/azure-devops-node-api
- Latest Version: 15.1.2 (as of December 2025)

### Installation

```bash
npm install azure-devops-node-api
# or
yarn add azure-devops-node-api
```

### Available APIs

The package provides TypeScript clients for all Azure DevOps services:

1. **Git API** (`GitApi`)
   - Repositories
   - Pull Requests
   - Commits
   - Pushes
   - Refs (branches/tags)
   - Items (files)
   - Pull Request Threads (comments)

2. **Build API** (`BuildApi`)
   - Build definitions
   - Builds
   - Build artifacts

3. **Work Item Tracking API** (`WorkItemTrackingApi`)
   - Work items
   - Queries
   - Work item types

4. **Release API** (`ReleaseApi`)
   - Release definitions
   - Releases
   - Approvals

5. **Core API** (`CoreApi`)
   - Projects
   - Teams
   - Process

6. **Task Agent API** (`TaskAgentApi`)
   - Agent pools
   - Agents
   - Task groups

7. **Test API** (`TestApi`)
   - Test plans
   - Test suites
   - Test cases

8. **Wiki API** (`WikiApi`)
   - Wiki pages
   - Wiki attachments

9. **Pipelines API** (`PipelinesApi`)
   - Pipeline definitions
   - Pipeline runs

### Example Usage

```typescript
import * as azdev from 'azure-devops-node-api';
import { GitPullRequest, GitPullRequestSearchCriteria } from 'azure-devops-node-api/interfaces/GitInterfaces';

// Connect to Azure DevOps
const orgUrl = 'https://dev.azure.com/your-org';
const token = process.env.AZURE_DEVOPS_PAT;
const authHandler = azdev.getPersonalAccessTokenHandler(token);
const connection = new azdev.WebApi(orgUrl, authHandler);

// Get Git API client
const gitApi = await connection.getGitApi();

// Get repository
const project = 'your-project';
const repoName = 'your-repo';
const repo = await gitApi.getRepository(repoName, project);

// Create a pull request
const pullRequest: GitPullRequest = {
  sourceRefName: 'refs/heads/feature/my-feature',
  targetRefName: 'refs/heads/main',
  title: 'My PR Title',
  description: 'PR description',
  isDraft: false,
};

const createdPr = await gitApi.createPullRequest(pullRequest, repo.id, project);
console.log(`Created PR #${createdPr.pullRequestId}`);

// List active pull requests
const searchCriteria: GitPullRequestSearchCriteria = {
  status: 2, // Active status
  repositoryId: repo.id,
};

const prs = await gitApi.getPullRequests(repo.id, searchCriteria, project);
prs.forEach(pr => {
  console.log(`#${pr.pullRequestId}: ${pr.title}`);
});

// Add reviewers
const reviewers = [
  { id: 'user-id-or-email' }
];

for (const reviewer of reviewers) {
  await gitApi.createPullRequestReviewer(
    reviewer,
    repo.id,
    createdPr.pullRequestId,
    reviewer.id,
    project
  );
}

// Add comment/thread to PR
const thread = {
  comments: [
    {
      content: 'This looks good!',
      commentType: 1, // text
    }
  ],
  status: 1, // active
};

await gitApi.createThread(thread, repo.id, createdPr.pullRequestId, project);

// Update PR status (complete/abandon)
const updatePr: GitPullRequest = {
  status: 3, // Completed (1=Active, 2=Abandoned, 3=Completed)
};

await gitApi.updatePullRequest(updatePr, repo.id, createdPr.pullRequestId, project);
```

### Git Operations Example

```typescript
// Get commits
const commits = await gitApi.getCommits(repo.id, { itemVersion: { version: 'main' } }, project);

// Create/update file
const change = {
  changeType: 1, // Add
  item: { path: '/README.md' },
  newContent: {
    content: 'Hello World',
    contentType: 0, // RawText
  },
};

const push = {
  refUpdates: [{ name: 'refs/heads/main', oldObjectId: commits[0].commitId }],
  commits: [{
    comment: 'Update README',
    changes: [change],
  }],
};

await gitApi.createPush(push, repo.id, project);

// Get branches
const branches = await gitApi.getRefs(repo.id, project, 'heads');
branches.forEach(branch => {
  console.log(branch.name); // refs/heads/main
});

// Create branch
const newBranchRef = {
  name: 'refs/heads/feature/new-feature',
  oldObjectId: '0000000000000000000000000000000000000000', // Create new ref
  newObjectId: commits[0].commitId, // Point to this commit
};

await gitApi.updateRefs([newBranchRef], repo.id, project);
```

---

## 3. tfx-cli (Team Foundation Extensions CLI)

### Overview
Command-line tool for managing Azure DevOps extensions and marketplace.

**Links**:
- NPM: https://www.npmjs.com/package/tfx-cli
- GitHub: https://github.com/Microsoft/tfs-cli
- Latest Version: 0.23.1

### Installation & Usage

```bash
npm install -g tfx-cli

# Login
tfx login --auth-type pat --token <your-pat>

# Create extension
tfx extension create --manifest-globs vss-extension.json

# Publish extension
tfx extension publish --manifest-globs vss-extension.json --share-with your-org
```

**Note**: This tool is primarily for extension developers, not general CLI workflows.

---

## 4. azure-devops-mcp (MCP Server for AI Agents)

### Overview
Official Microsoft MCP (Model Context Protocol) server for AI agents to interact with Azure DevOps.

**Links**:
- NPM: https://www.npmjs.com/package/@azure-devops/mcp
- GitHub: https://github.com/microsoft/azure-devops-mcp
- Latest Version: 2.4.0 (January 2026)

This is specifically designed for AI/agent workflows similar to what you're building!

### Features
- Work item management
- Pull request operations
- Repository browsing
- Pipeline interactions

### Installation & Usage

```bash
npm install @azure-devops/mcp

# Configuration in MCP settings
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/your-org",
        "AZURE_DEVOPS_PAT": "your-pat-token"
      }
    }
  }
}
```

---

## 5. Workflow Comparison: Azure DevOps vs GitHub

### GitHub Workflow (with `gh` CLI)
```bash
# Make changes
git add .
git commit -m "feat: add new feature"
git push origin feature/my-feature

# Create PR
gh pr create --title "My Feature" --body "Description" --base main

# View PR
gh pr view

# Merge PR
gh pr merge --squash
```

### Azure DevOps Workflow (with `az` CLI)
```bash
# Make changes
git add .
git commit -m "feat: add new feature"
git push origin feature/my-feature

# Create PR
az repos pr create \
  --source-branch feature/my-feature \
  --target-branch main \
  --title "My Feature" \
  --description "Description"

# View PR (by ID from previous command output)
az repos pr show --id 123

# Complete/merge PR
az repos pr update --id 123 --status completed
```

### Key Differences

| Aspect | GitHub (`gh`) | Azure DevOps (`az repos`) |
|--------|---------------|---------------------------|
| **CLI Tool** | `gh` (standalone) | `az` (with extension) |
| **Installation** | Single binary | Azure CLI + extension |
| **Authentication** | OAuth device flow, token | PAT or AAD login |
| **PR Creation** | Auto-detects current branch | Requires explicit branch names |
| **PR Reference** | Can use current PR context | Must use PR ID |
| **Work Item Linking** | N/A (uses issues) | `--work-items` flag |
| **Auto-complete** | Not built-in | `--auto-complete` flag |
| **Draft PRs** | `--draft` flag | `--draft` flag |
| **Reviewers** | `--reviewer` flag | `--reviewers` flag |

### Azure DevOps Advantages
- Built-in work item integration
- Auto-complete/auto-merge with policies
- More granular access control
- Better integration with enterprise Azure services

### GitHub Advantages
- Simpler CLI interface
- Better context awareness (current branch, PR)
- More intuitive commands
- Larger ecosystem and community

---

## 6. Open-Source Tools Wrapping Azure DevOps

### 1. **azure-devops-mcp** (Official Microsoft)
- **GitHub**: https://github.com/microsoft/azure-devops-mcp
- **Description**: MCP server for AI agents
- **Stars**: New (2026)
- **Language**: TypeScript
- **Use Case**: AI agent integration

### 2. **Backstage Azure DevOps Plugin**
- **NPM**: `@backstage-community/plugin-scaffolder-backend-module-azure-devops`
- **GitHub**: https://github.com/backstage/community-plugins
- **Description**: Backstage integration for Azure DevOps
- **Use Case**: Developer portals, scaffolding

### 3. **Azure DevOps Extension API**
- **NPM**: https://www.npmjs.com/package/azure-devops-extension-api
- **GitHub**: https://github.com/Microsoft/azure-devops-extension-api
- **Description**: REST client for Azure DevOps web extensions
- **Version**: 4.268.0
- **Use Case**: Building Azure DevOps extensions

### 4. **Third-Party MCP Server**
- **NPM**: `@tiberriver256/mcp-server-azure-devops`
- **GitHub**: https://github.com/Tiberriver256/mcp-server-azure-devops
- **Description**: Community MCP server
- **Use Case**: Alternative AI agent integration

---

## 7. Example: Complete Coding Agent Workflow

### Scenario: Agent makes code changes and creates a PR

```typescript
import * as azdev from 'azure-devops-node-api';
import * as git from 'simple-git';

class AzureDevOpsAgent {
  private gitApi: any;
  private repoId: string;
  private project: string;

  async initialize() {
    const orgUrl = 'https://dev.azure.com/my-org';
    const token = process.env.AZURE_DEVOPS_PAT;
    const authHandler = azdev.getPersonalAccessTokenHandler(token);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    
    this.gitApi = await connection.getGitApi();
    this.project = 'my-project';
    const repo = await this.gitApi.getRepository('my-repo', this.project);
    this.repoId = repo.id;
  }

  async createFeatureBranch(branchName: string) {
    // Get main branch commit
    const refs = await this.gitApi.getRefs(
      this.repoId,
      this.project,
      'heads/main'
    );
    const mainCommit = refs[0].objectId;

    // Create new branch
    const newRef = [{
      name: `refs/heads/${branchName}`,
      oldObjectId: '0000000000000000000000000000000000000000',
      newObjectId: mainCommit,
    }];

    await this.gitApi.updateRefs(newRef, this.repoId, this.project);
  }

  async commitChanges(branchName: string, files: Array<{path: string, content: string}>, message: string) {
    // Get branch commit
    const refs = await this.gitApi.getRefs(
      this.repoId,
      this.project,
      `heads/${branchName}`
    );
    const oldCommit = refs[0].objectId;

    // Create changes
    const changes = files.map(file => ({
      changeType: 2, // Edit (1=Add, 2=Edit, 3=Delete)
      item: { path: file.path },
      newContent: {
        content: file.content,
        contentType: 0, // RawText
      },
    }));

    // Create push
    const push = {
      refUpdates: [{
        name: `refs/heads/${branchName}`,
        oldObjectId: oldCommit,
      }],
      commits: [{
        comment: message,
        changes: changes,
      }],
    };

    await this.gitApi.createPush(push, this.repoId, this.project);
  }

  async createPullRequest(sourceBranch: string, title: string, description: string) {
    const pr = {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: 'refs/heads/main',
      title: title,
      description: description,
      isDraft: false,
    };

    const createdPr = await this.gitApi.createPullRequest(
      pr,
      this.repoId,
      this.project
    );

    console.log(`Created PR #${createdPr.pullRequestId}: ${createdPr.url}`);
    return createdPr;
  }
}

// Usage
const agent = new AzureDevOpsAgent();
await agent.initialize();
await agent.createFeatureBranch('feature/agent-changes');
await agent.commitChanges(
  'feature/agent-changes',
  [{ path: '/src/index.ts', content: '// New code' }],
  'feat: implement new feature'
);
await agent.createPullRequest(
  'feature/agent-changes',
  'Automated changes by AI agent',
  'This PR was created by an AI coding agent'
);
```

### Using CLI in a Shell Script

```bash
#!/bin/bash
set -e

# Configuration
ORG="https://dev.azure.com/my-org"
PROJECT="my-project"
REPO="my-repo"
BRANCH="feature/agent-$(date +%s)"

# Set defaults
az devops configure --defaults organization=$ORG project=$PROJECT

# Create and checkout branch
git checkout -b $BRANCH

# Make changes (simulated)
echo "# Agent Changes" > CHANGES.md
git add CHANGES.md
git commit -m "feat: automated changes by agent"

# Push branch
git push origin $BRANCH

# Create PR
PR_ID=$(az repos pr create \
  --repository $REPO \
  --source-branch $BRANCH \
  --target-branch main \
  --title "Automated Agent Changes" \
  --description "This PR contains automated changes" \
  --output tsv \
  --query "pullRequestId")

echo "Created PR #$PR_ID"

# Add reviewers (optional)
az repos pr reviewer add \
  --id $PR_ID \
  --reviewers "team@example.com"

# View PR URL
az repos pr show --id $PR_ID --query "url" -o tsv
```

---

## 8. Authentication & Security

### Personal Access Token (PAT)

1. **Create PAT**:
   - Navigate to: `https://dev.azure.com/{organization}/_usersSettings/tokens`
   - Click "New Token"
   - Set name and expiration
   - Select scopes:
     - **Code**: Read & Write (for Git operations)
     - **Code**: Status (for PR status)
     - **Work Items**: Read & Write (for work item linking)

2. **Use PAT**:
   ```bash
   # Environment variable (recommended)
   export AZURE_DEVOPS_EXT_PAT=your_pat_token
   
   # Or store in config (less secure)
   az devops login --organization https://dev.azure.com/your-org
   ```

### Service Principal / Managed Identity

For production agent systems:

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import * as azdev from 'azure-devops-node-api';

const credential = new DefaultAzureCredential();
const token = await credential.getToken('499b84ac-1321-427f-aa17-267ca6975798/.default');

const authHandler = azdev.getBearerHandler(token.token);
const connection = new azdev.WebApi(orgUrl, authHandler);
```

---

## 9. Rate Limits & Best Practices

### Azure DevOps Rate Limits
- **REST API**: 200 requests per user per minute
- **Git operations**: No documented limit, but use batching
- **Webhook events**: 1000 events per hour per subscription

### Best Practices for Agents

1. **Batch operations** when possible
2. **Cache repository/project metadata**
3. **Use webhooks** instead of polling
4. **Implement exponential backoff** for retries
5. **Use service principals** for production systems
6. **Monitor API usage** via Azure DevOps analytics

---

## 10. Additional Resources

### Official Microsoft Documentation
- **Azure CLI DevOps Extension**: https://learn.microsoft.com/en-us/cli/azure/devops
- **Azure DevOps REST API**: https://learn.microsoft.com/en-us/rest/api/azure/devops
- **Git REST API Reference**: https://learn.microsoft.com/en-us/rest/api/azure/devops/git
- **Pull Request REST API**: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests

### NPM Packages
- **azure-devops-node-api**: https://www.npmjs.com/package/azure-devops-node-api
- **@azure-devops/mcp**: https://www.npmjs.com/package/@azure-devops/mcp
- **tfx-cli**: https://www.npmjs.com/package/tfx-cli
- **azure-devops-extension-api**: https://www.npmjs.com/package/azure-devops-extension-api

### GitHub Repositories
- **azure-devops-node-api**: https://github.com/Microsoft/azure-devops-node-api
- **azure-devops-mcp**: https://github.com/microsoft/azure-devops-mcp
- **tfs-cli**: https://github.com/Microsoft/tfs-cli
- **azure-devops-extension-api**: https://github.com/Microsoft/azure-devops-extension-api

### Community Tools
- **Backstage Azure DevOps**: https://github.com/backstage/community-plugins
- **Community MCP Server**: https://github.com/Tiberriver256/mcp-server-azure-devops

---

## 11. Recommendations for Coding Agents

### For TypeScript/Node.js Agents
**Use**: `azure-devops-node-api`
- Full TypeScript support with types
- Direct API access without shell dependencies
- Better error handling and async/await support
- Suitable for complex workflows

### For Shell-Based Agents
**Use**: `az devops` CLI extension
- Simple command-line interface
- Easy to integrate with existing scripts
- Good for straightforward PR workflows
- Requires Azure CLI installation

### For AI/LLM Agents
**Use**: `@azure-devops/mcp` (official MCP server)
- Purpose-built for AI agent interactions
- Follows Model Context Protocol standard
- Officially maintained by Microsoft
- Best for Claude/GPT-based agents

### Hybrid Approach (Recommended)
```typescript
// Use azure-devops-node-api for complex operations
import * as azdev from 'azure-devops-node-api';

// Shell out to `az` CLI for simple operations
import { execSync } from 'child_process';

class HybridAgent {
  // Complex: Use Node API
  async createPRWithThreads() {
    const gitApi = await this.connection.getGitApi();
    const pr = await gitApi.createPullRequest(/* ... */);
    // Add complex threading logic
  }

  // Simple: Use CLI
  async mergePR(prId: number) {
    execSync(`az repos pr update --id ${prId} --status completed`);
  }
}
```

---

## Conclusion

Azure DevOps provides robust CLI and API tooling suitable for coding agent workflows:

- **Primary tool**: `az repos pr create` via Azure CLI extension
- **Programmatic access**: `azure-devops-node-api` for TypeScript/JavaScript
- **AI agents**: `@azure-devops/mcp` official MCP server
- **Workflow**: Similar to GitHub but requires explicit branch names and PR IDs

The ecosystem is mature and well-documented, making it suitable for enterprise coding agent implementations.

