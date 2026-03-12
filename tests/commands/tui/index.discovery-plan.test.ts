import { beforeEach, expect, test } from "bun:test";
import { buildChatStartupDiscoveryPlan } from "@/commands/cli/chat.ts";
import { globalRegistry, initializeCommandsAsync } from "@/commands/tui/index.ts";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

beforeEach(() => {
  globalRegistry.clear();
});

test("initializeCommandsAsync forwards startup discovery plan to disk discovery", async () => {
  const plan = buildChatStartupDiscoveryPlan("copilot", {
    projectRoot: "/tmp/atomic-ui-index-project",
    homeDir: "/tmp/atomic-ui-index-home",
    xdgConfigHome: "/tmp/atomic-ui-index-home/.config",
    pathExists: () => false,
  });

  const skillDiscoveryPlans: Array<ProviderDiscoveryPlan | undefined> = [];
  const agentDiscoveryPlans: Array<ProviderDiscoveryPlan | undefined> = [];

  await initializeCommandsAsync({
    providerDiscoveryPlan: plan,
    loadWorkflowsFromDiskFn: async () => {},
    discoverAndRegisterDiskSkillsFn: async (providerDiscoveryPlan) => {
      skillDiscoveryPlans.push(providerDiscoveryPlan);
    },
    registerAgentCommandsFn: async (providerDiscoveryPlan) => {
      agentDiscoveryPlans.push(providerDiscoveryPlan);
    },
  });

  expect(skillDiscoveryPlans).toEqual([plan]);
  expect(agentDiscoveryPlans).toEqual([plan]);
  expect(agentDiscoveryPlans[0]?.compatibilitySets.compatibilityRootIds.size).toBe(
    0
  );
});
