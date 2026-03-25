/**
 * Barrel export for all test mock factories.
 *
 * Usage:
 *   import { mockClaudeSDK, mockOpenCodeSDK, mockCopilotSDK, mockFS } from "tests/test-support/mocks";
 */

export {
  FakeClaudeSession,
  FakeClaudeQuery,
  FakeClaudeAgentSDK,
  mockClaudeSDK,
  type MockClaudeSDKOptions,
} from "./sdk-claude.ts";

export {
  FakeOpenCodeSession,
  FakeOpenCodeClient,
  createFakeOpenCodeEvent,
  mockOpenCodeSDK,
  type FakeOpenCodeEvent,
  type MockOpenCodeSDKOptions,
} from "./sdk-opencode.ts";

export {
  FakeCopilotSession,
  FakeCopilotClient,
  createFakeCopilotSessionEvent,
  createFakeCopilotPermissionRequest,
  mockCopilotSDK,
  type FakeCopilotSessionEvent,
  type FakeCopilotPermissionRequest,
  type MockCopilotSDKOptions,
} from "./sdk-copilot.ts";

export {
  mockFS,
  resetFS,
  addVirtualFiles,
  removeVirtualFile,
  getVirtualFiles,
} from "./fs.ts";
