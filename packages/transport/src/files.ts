export interface WorkspaceFileTransfer {
  upload(sessionId: string, file: Blob, filename: string): Promise<unknown>;
  download(sessionId: string, relativePath: string): Promise<Blob>;
}

export function createHttpFileTransfer(baseUrl: string, fetchLike: typeof fetch = fetch): WorkspaceFileTransfer {
  const root = baseUrl.replace(/\/$/, "");
  return {
    async upload(sessionId, file, filename) {
      const body = new FormData(); body.append("file", file, filename); body.append("sessionId", sessionId);
      const response = await fetchLike(`${root}/api/workspace/upload`, { method: "POST", body });
      if (!response.ok) throw new Error(`Workspace upload failed: ${response.status}`);
      return response.json();
    },
    async download(sessionId, relativePath) {
      const response = await fetchLike(`${root}/api/workspace/download?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(relativePath)}`);
      if (!response.ok) throw new Error(`Workspace download failed: ${response.status}`);
      return response.blob();
    },
  };
}
