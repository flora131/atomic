export function getInputFilePath(input: Record<string, unknown>): string | undefined {
  return (input.file_path ?? input.path ?? input.filePath) as string | undefined;
}

export function getFilename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}
