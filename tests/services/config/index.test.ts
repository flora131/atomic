import { beforeEach } from "bun:test";
import { clearProviderDiscoverySessionCache } from "@/services/config/provider-discovery-cache.ts";
import "./load-agents.suite.ts";
import "./load-copilot-agents.suite.ts";
import "./resolve-copilot-skills.suite.ts";
import "./load-copilot-instructions.suite.ts";

beforeEach(() => {
  clearProviderDiscoverySessionCache();
});
