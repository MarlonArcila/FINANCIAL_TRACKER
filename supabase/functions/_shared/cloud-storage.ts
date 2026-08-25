import type { StorageProvider } from "./storage-oauth.ts";

export interface UploadedBackup {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

export async function uploadBackupFile(
  provider: StorageProvider,
  accessToken: string,
  filename: string,
  content: string,
  backupRunId?: string,
): Promise<UploadedBackup> {
  requireGoogleDriveProvider(provider);

  return await uploadGoogleDrive(
    accessToken,
    filename,
    content,
    backupRunId,
  );
}

export async function downloadBackupFile(
  provider: StorageProvider,
  accessToken: string,
  remoteFileId: string,
): Promise<string> {
  requireGoogleDriveProvider(provider);

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteFileId)}?alt=media`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      redirect: "follow",
    },
  );

  if (!response.ok) {
    throw new Error("cloud_download_failed");
  }

  const text = await response.text();

  if (
    new TextEncoder().encode(text).length >
      50 * 1024 * 1024
  ) {
    throw new Error("backup_too_large");
  }

  return text;
}

async function uploadGoogleDrive(
  token: string,
  filename: string,
  content: string,
  runId?: string,
): Promise<UploadedBackup> {
  const existing = runId
    ? await findGoogleRun(token, runId)
    : null;

  if (existing) {
    return await updateGoogleDrive(
      token,
      existing.id,
      existing.name ?? filename,
      content,
    );
  }

  const boundary =
    `capitalflow_${crypto.randomUUID().replaceAll("-", "")}`;

  const metadata = JSON.stringify({
    name: filename,
    parents: ["appDataFolder"],
    appProperties: runId
      ? { capitalflow_backup_run_id: runId }
      : undefined,
  });

  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n`,
    `--${boundary}--`,
  ].join("");

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type":
          `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  return googleResult(
    await response.json(),
    response.ok,
    filename,
    content,
  );
}

async function findGoogleRun(
  token: string,
  runId: string,
): Promise<{ id: string; name?: string } | null> {
  const query = encodeURIComponent(
    "appProperties has { key='capitalflow_backup_run_id' and value='" +
      runId +
      "' } and trashed = false",
  );

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name)&pageSize=1`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("google_drive_lookup_failed");
  }

  const data = await response.json() as {
    files?: Array<{
      id: string;
      name?: string;
    }>;
  };

  return data.files?.[0] ?? null;
}

async function updateGoogleDrive(
  token: string,
  id: string,
  filename: string,
  content: string,
): Promise<UploadedBackup> {
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name,size,createdTime`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: content,
    },
  );

  return googleResult(
    await response.json(),
    response.ok,
    filename,
    content,
  );
}

function googleResult(
  payload: {
    id?: string;
    name?: string;
    size?: string;
    createdTime?: string;
  },
  ok: boolean,
  filename: string,
  content: string,
): UploadedBackup {
  if (!ok || !payload.id) {
    throw new Error("google_drive_upload_failed");
  }

  return {
    id: payload.id,
    name: payload.name ?? filename,
    size: Number(
      payload.size ??
        new TextEncoder().encode(content).length,
    ),
    createdAt:
      payload.createdTime ?? new Date().toISOString(),
  };
}

function requireGoogleDriveProvider(
  provider: unknown,
): void {
  if (provider !== "google_drive") {
    throw new Error("unsupported_storage_provider");
  }
}
