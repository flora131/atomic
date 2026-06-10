export type StaleDocTask = {
  id: string;
  title: string;
  owner_docs: string[];
  reason: string;
  source_refs: string[];
  update_instructions: string;
  acceptance_criteria: string[];
};

export const sanitizeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const normalizeOwnerDocPath = (path: string): string => {
  let normalized = path.trim().replace(/\\+/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.replace(/\/+/g, "/");
};

const dedupeStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
};

const dedupeOwnerDocs = (paths: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const path of paths) {
    const normalized = normalizeOwnerDocPath(path);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
};

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index];
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent[rightRoot] = leftRoot;
    }
  }
}

const mergeTaskGroup = (tasks: readonly StaleDocTask[], firstIndex: number): StaleDocTask => {
  if (tasks.length === 1) {
    const [task] = tasks;
    return {
      ...task,
      owner_docs: dedupeOwnerDocs(task.owner_docs),
      source_refs: dedupeStrings(task.source_refs),
      acceptance_criteria: dedupeStrings(task.acceptance_criteria),
    };
  }

  const ids = tasks.map((task) => sanitizeSegment(task.id));
  const baseId = sanitizeSegment(`merged-${firstIndex + 1}-${ids.join("-")}`);
  const id = baseId.length > 120 ? baseId.slice(0, 120).replace(/-+$/g, "") : baseId;

  return {
    id,
    title: `Merged stale docs updates: ${tasks.map((task) => task.title).join("; ")}`,
    owner_docs: dedupeOwnerDocs(tasks.flatMap((task) => task.owner_docs)),
    reason: tasks.map((task) => `- ${task.id}: ${task.reason}`).join("\n"),
    source_refs: dedupeStrings(tasks.flatMap((task) => task.source_refs)),
    update_instructions: tasks.map((task) => `## ${task.id}: ${task.title}\n${task.update_instructions}`).join("\n\n"),
    acceptance_criteria: dedupeStrings(tasks.flatMap((task) => task.acceptance_criteria)),
  };
};

export const mergeStaleDocTasksByOwnerDocs = (tasks: readonly StaleDocTask[]): StaleDocTask[] => {
  if (tasks.length < 2) {
    return tasks.map((task, index) => mergeTaskGroup([task], index));
  }

  const groups = new DisjointSet(tasks.length);
  const ownerDocToFirstTask = new Map<string, number>();

  tasks.forEach((task, taskIndex) => {
    for (const ownerDoc of dedupeOwnerDocs(task.owner_docs)) {
      const firstTaskIndex = ownerDocToFirstTask.get(ownerDoc);
      if (firstTaskIndex === undefined) {
        ownerDocToFirstTask.set(ownerDoc, taskIndex);
      } else {
        groups.union(firstTaskIndex, taskIndex);
      }
    }
  });

  const components = new Map<number, { firstIndex: number; tasks: StaleDocTask[] }>();
  tasks.forEach((task, taskIndex) => {
    const root = groups.find(taskIndex);
    const component = components.get(root);
    if (component === undefined) {
      components.set(root, { firstIndex: taskIndex, tasks: [task] });
      return;
    }
    component.tasks.push(task);
  });

  return [...components.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((component) => mergeTaskGroup(component.tasks, component.firstIndex));
};
