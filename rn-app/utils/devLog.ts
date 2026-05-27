import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { getLocalDateString } from './date';

const DEV_LOG_DATES_KEY = 'dev_activity_log_dates_v1';
const DEV_LOG_EXPORT_DIR_URI_KEY = 'dev_activity_logs_export_dir_uri_v1';
const MAX_DEV_LOGS_PER_DAY = 5000;

export type DevLogEntry = {
  id: string;
  ts: number;
  area: string;
  action: string;
  details?: Record<string, unknown>;
};

let writeQueue: Promise<void> = Promise.resolve();
const loggedDevFilePaths = new Set<string>();

const getDevLogsKeyForDate = (date: string) => `dev_activity_logs_v1:${date}`;
const getDevLogFileForDate = (date: string) => new File(Paths.document, `dev-activity-logs-${date}.json`);

const ensureTrackedDate = async (date: string) => {
  const raw = await AsyncStorage.getItem(DEV_LOG_DATES_KEY);
  const dates: string[] = raw ? JSON.parse(raw) : [];
  if (!dates.includes(date)) {
    dates.push(date);
    dates.sort();
    await AsyncStorage.setItem(DEV_LOG_DATES_KEY, JSON.stringify(dates));
  }
};

const getTrackedDates = async (): Promise<string[]> => {
  const raw = await AsyncStorage.getItem(DEV_LOG_DATES_KEY);
  const dates: string[] = raw ? JSON.parse(raw) : [];
  return dates.sort();
};

const safeSerialize = (value: unknown): unknown => {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(safeSerialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, inner]) => {
      out[key] = safeSerialize(inner);
    });
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
};

export const appendDevLog = async (
  area: string,
  action: string,
  details?: Record<string, unknown>
) => {
  const nowTs = Date.now();
  const logDate = getLocalDateString(new Date(nowTs));
  const entry: DevLogEntry = {
    id: `${nowTs}-${Math.random().toString(36).slice(2, 8)}`,
    ts: nowTs,
    area,
    action,
    details: details ? (safeSerialize(details) as Record<string, unknown>) : undefined,
  };

  console.log(`[DEV_LOG] ${area}:${action}`, entry.details || {});

  writeQueue = writeQueue.then(async () => {
    try {
      const logsKey = getDevLogsKeyForDate(logDate);
      const raw = await AsyncStorage.getItem(logsKey);
      const logs: DevLogEntry[] = raw ? JSON.parse(raw) : [];
      logs.push(entry);
      const trimmed = logs.slice(-MAX_DEV_LOGS_PER_DAY);
      await AsyncStorage.setItem(logsKey, JSON.stringify(trimmed));
      await ensureTrackedDate(logDate);

      const devLogFile = getDevLogFileForDate(logDate);
      if (!devLogFile.exists) {
        devLogFile.create();
      }
      devLogFile.write(
        JSON.stringify(
          {
            exportedAt: Date.now(),
            date: logDate,
            count: trimmed.length,
            logs: trimmed,
          },
          null,
          2
        )
      );
      const devLogFilePath = devLogFile.uri.replace('file://', '');
      if (!loggedDevFilePaths.has(devLogFilePath)) {
        loggedDevFilePaths.add(devLogFilePath);
        console.log(`[DEV_LOG_FILE] ${devLogFilePath}`);
      }
    } catch (error) {
      console.warn('[DEV_LOG] Failed to persist dev log entry:', error);
    }
  });

  return writeQueue;
};

export const getDevLogs = async (date: string = getLocalDateString()): Promise<DevLogEntry[]> => {
  const raw = await AsyncStorage.getItem(getDevLogsKeyForDate(date));
  return raw ? JSON.parse(raw) : [];
};

export const getAllDevLogsByDate = async (): Promise<Record<string, DevLogEntry[]>> => {
  const dates = await getTrackedDates();
  const entries = await Promise.all(
    dates.map(async (date) => [date, await getDevLogs(date)] as const)
  );
  return Object.fromEntries(entries);
};

export const clearDevLogs = async () => {
  const dates = await getTrackedDates();
  await Promise.all([
    AsyncStorage.removeItem(DEV_LOG_DATES_KEY),
    ...dates.map((date) => AsyncStorage.removeItem(getDevLogsKeyForDate(date))),
  ]);

  for (const date of dates) {
    try {
      const devLogFile = getDevLogFileForDate(date);
      if (devLogFile.exists) {
        devLogFile.delete();
      }
      loggedDevFilePaths.delete(devLogFile.uri.replace('file://', ''));
    } catch (_) {
      // no-op
    }
  }
};

export const getDevLogFilePath = (date: string = getLocalDateString()) =>
  getDevLogFileForDate(date).uri.replace('file://', '');
export const getDevLogFileUri = (date: string = getLocalDateString()) =>
  getDevLogFileForDate(date).uri;

export const exportDevLogsToPublicDirectory = async (): Promise<string> => {
  let targetDirUri = await AsyncStorage.getItem(DEV_LOG_EXPORT_DIR_URI_KEY);

  if (!targetDirUri) {
    const initialUri = LegacyFileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
    if (!permission.granted || !permission.directoryUri) {
      throw new Error('Public directory permission was not granted.');
    }
    targetDirUri = permission.directoryUri;
    await AsyncStorage.setItem(DEV_LOG_EXPORT_DIR_URI_KEY, targetDirUri);
  }

  const logsByDate = await getAllDevLogsByDate();
  const dates = Object.keys(logsByDate).sort();

  if (dates.length === 0) {
    throw new Error('No developer logs are available to export.');
  }

  const exportedUris: string[] = [];

  for (const date of dates) {
    const logs = logsByDate[date];
    const exportPayload = JSON.stringify(
      {
        exportedAt: Date.now(),
        date,
        count: logs.length,
        logs,
      },
      null,
      2
    );

    const fileBasename = `dev-activity-logs-${date}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const fileUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
      targetDirUri,
      fileBasename,
      'application/json'
    );
    await LegacyFileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, exportPayload);
    exportedUris.push(fileUri);
  }

  return `Exported ${exportedUris.length} file(s):\n${exportedUris.join('\n')}`;
};
