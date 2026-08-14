import type { StorageProvider } from "./storage-oauth.ts";

export interface UploadedBackup {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

export async function uploadBackupFile(provider: StorageProvider, accessToken: string, filename: string, content: string): Promise<UploadedBackup> {
  if (provider === "google_drive") return await uploadGoogleDrive(accessToken, filename, content);
  return await uploadOneDrive(accessToken, filename, content);
}

export async function downloadBackupFile(provider: StorageProvider, accessToken: string, remoteFileId: string): Promise<string> {
  const url = provider === "google_drive"
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteFileId)}?alt=media`
    : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(remoteFileId)}/content`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, redirect: "follow" });
  if (!response.ok) throw new Error(`Cloud download failed (${provider}) ${response.status}: ${await response.text()}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 50 * 1024 * 1024) throw new Error("Backup exceeds the 50 MB restore limit");
  return text;
}

async function uploadGoogleDrive(accessToken: string, filename: string, content: string): Promise<UploadedBackup> {
  const boundary = `capitalflow_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = JSON.stringify({ name: filename, parents: ["appDataFolder"] });
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n`,
    `--${boundary}--`,
  ].join("");
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime";
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const payload = await response.json() as { id?: string; name?: string; size?: string; createdTime?: string; error?: unknown };
  if (!response.ok || !payload.id) throw new Error(`Google Drive upload failed ${response.status}: ${JSON.stringify(payload)}`);
  return { id: payload.id, name: payload.name ?? filename, size: Number(payload.size ?? new TextEncoder().encode(content).length), createdAt: payload.createdTime ?? new Date().toISOString() };
}

async function uploadOneDrive(accessToken: string, filename: string, content: string): Promise<UploadedBackup> {
  const rootResponse = await fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot?$select=id", { headers: { authorization: `Bearer ${accessToken}` } });
  const root = await rootResponse.json() as { id?: string };
  if (!rootResponse.ok || !root.id) throw new Error(`OneDrive app folder failed ${rootResponse.status}: ${JSON.stringify(root)}`);
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(root.id)}:/${encodeURIComponent(filename)}:/content`;
  const response = await fetch(url, { method: "PUT", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: content });
  const payload = await response.json() as { id?: string; name?: string; size?: number; createdDateTime?: string };
  if (!response.ok || !payload.id) throw new Error(`OneDrive upload failed ${response.status}: ${JSON.stringify(payload)}`);
  return { id: payload.id, name: payload.name ?? filename, size: Number(payload.size ?? new TextEncoder().encode(content).length), createdAt: payload.createdDateTime ?? new Date().toISOString() };
}
