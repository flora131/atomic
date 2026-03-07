export interface SkillLoadLike {
  skillName: string;
}

export interface SkillLoadPartLike {
  type: string;
  skills?: SkillLoadLike[];
}

export interface SkillLoadMessageLike {
  skillLoads?: SkillLoadLike[];
  parts?: SkillLoadPartLike[];
}

export function normalizeSkillTrackingKey(skillName: string): string {
  return skillName.trim().toLowerCase();
}

export function normalizeSessionTrackingKey(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") {
    return null;
  }
  const normalized = sessionId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function shouldResetLoadedSkillsForSessionChange(
  previousSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): boolean {
  const previous = normalizeSessionTrackingKey(previousSessionId);
  const next = normalizeSessionTrackingKey(nextSessionId);
  return previous !== null && next !== null && previous !== next;
}

function collectSkillLoads(message: SkillLoadMessageLike): SkillLoadLike[] {
  const directSkillLoads = message.skillLoads ?? [];
  const partSkillLoads = (message.parts ?? [])
    .filter((part) => part.type === "skill-load")
    .flatMap((part) => part.skills ?? []);
  return [...directSkillLoads, ...partSkillLoads];
}

export function createLoadedSkillTrackingSet(
  messages: readonly SkillLoadMessageLike[],
): Set<string> {
  const loaded = new Set<string>();
  for (const message of messages) {
    for (const skill of collectSkillLoads(message)) {
      const key = normalizeSkillTrackingKey(skill.skillName);
      if (key.length > 0) {
        loaded.add(key);
      }
    }
  }
  return loaded;
}

export function tryTrackLoadedSkill(
  loadedSkills: Set<string>,
  skillName: string,
): boolean {
  const key = normalizeSkillTrackingKey(skillName);
  if (key.length === 0 || loadedSkills.has(key)) {
    return false;
  }
  loadedSkills.add(key);
  return true;
}
