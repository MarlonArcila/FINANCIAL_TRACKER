import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DetectedCandidate } from "@capitalflow/core";

import { invokeFunction } from "./api";

interface NotificationAccessPlugin {
  isPermissionGranted(): Promise<{ granted: boolean }>;
  openPermissionSettings(): Promise<void>;
  setAllowedPackages(options: { packages: string[] }): Promise<void>;
  getAllowedPackages(): Promise<{ packages: string[] }>;
  setDefaultCurrency(options: { currency: string }): Promise<void>;
  peekCandidates(): Promise<{ candidates: DetectedCandidate[] }>;
  ackCandidates(options: { localIds: string[] }): Promise<void>;
}

const NotificationAccess = registerPlugin<NotificationAccessPlugin>("NotificationAccess");

export function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function getNotificationPermission(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  return (await NotificationAccess.isPermissionGranted()).granted;
}

export async function openNotificationPermissionSettings(): Promise<void> {
  if (!isAndroidNative()) throw new Error("Disponible únicamente en la aplicación Android.");
  await NotificationAccess.openPermissionSettings();
}

export async function getAllowedNotificationPackages(): Promise<string[]> {
  if (!isAndroidNative()) return [];
  return (await NotificationAccess.getAllowedPackages()).packages;
}


export async function setNotificationDefaultCurrency(currency: string): Promise<void> {
  if (!isAndroidNative()) return;
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new Error("Código de moneda inválido.");
  await NotificationAccess.setDefaultCurrency({ currency: normalized });
}

export async function setAllowedNotificationPackages(packages: string[]): Promise<void> {
  if (!isAndroidNative()) throw new Error("Disponible únicamente en la aplicación Android.");
  const normalized = [...new Set(packages.map((item) => item.trim()).filter(Boolean))];
  await NotificationAccess.setAllowedPackages({ packages: normalized });
}

export async function syncAndroidCandidates(): Promise<{ sent: number; inserted: number; duplicates: number }> {
  if (!isAndroidNative()) return { sent: 0, inserted: 0, duplicates: 0 };
  const { candidates } = await NotificationAccess.peekCandidates();
  if (candidates.length === 0) return { sent: 0, inserted: 0, duplicates: 0 };

  const result = await invokeFunction<{
    inserted: number;
    duplicates: number;
    acknowledgedLocalIds: string[];
  }>("notification-ingest", { candidates });

  if (result.acknowledgedLocalIds.length > 0) {
    await NotificationAccess.ackCandidates({ localIds: result.acknowledgedLocalIds });
  }
  return { sent: candidates.length, inserted: result.inserted, duplicates: result.duplicates };
}
