export function createMockContext() {
  const messages: Array<{ role: string; content: string }> = [];
  const todoItems: any[] = [];
  let streaming = false;
  let workflowState: any = {};
  let workflowSessionDir: string | null = null;
  let workflowSessionId: string | null = null;
  let workflowTaskIds: Set<string> = new Set();

  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: (role: string, content: string) => {
      messages.push({ role, content });
    },
    setStreaming: (value: boolean) => {
      streaming = value;
    },
    updateWorkflowState: (update: any) => {
      workflowState = { ...workflowState, ...update };
    },
    setTodoItems: (items: any[]) => {
      todoItems.push(...items);
    },
    setWorkflowSessionDir: (dir: string | null) => {
      workflowSessionDir = dir;
    },
    setWorkflowSessionId: (id: string | null) => {
      workflowSessionId = id;
    },
    setWorkflowTaskIds: (ids: Set<string>) => {
      workflowTaskIds = ids;
    },
    spawnSubagentParallel: async () => [],
    _getMessages: () => messages,
    _getStreaming: () => streaming,
    _getWorkflowState: () => workflowState,
    _getSessionDir: () => workflowSessionDir,
    _getSessionId: () => workflowSessionId,
    _getTaskIds: () => workflowTaskIds,
  };
}
