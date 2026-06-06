export function textResult(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }], details: undefined }
}
