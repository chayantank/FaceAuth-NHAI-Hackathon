/**
 * SecureDB - Encrypted SQLite database for face embeddings and auth logs.
 *
 * Uses MMKV for high-performance encrypted key-value storage and
 * react-native-keychain for secure encryption key management.
 *
 * Architecture:
 * - Encryption key → stored in device Keychain (hardware-backed)
 * - Embeddings & auth logs → stored in MMKV (encrypted, fast)
 * - No raw biometric images are ever stored
 */

import type { MMKV } from 'react-native-mmkv';
import { createMMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrollmentRecord {
  id: string;
  name: string;
  /** Base64-encoded embedding vector */
  embeddingBase64: string;
  enrolledAt: number; // Unix timestamp
  synced: boolean;
  /** Number of frames used for enrollment */
  frameCount: number;
}

export interface AuthLogRecord {
  id: string;
  userId: string | null;
  timestamp: number;
  result: 'match' | 'no_match' | 'spoof_detected' | 'error';
  livenessScore: number;
  similarityScore: number;
  latencyMs: number;
  synced: boolean;
}

export interface SyncQueueItem {
  id: string;
  recordType: 'enrollment' | 'auth_log';
  recordId: string;
  createdAt: number;
  payload: string; // JSON stringified record
}

// ─── Constants ───────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'com.faceauth.app.db';
const ENCRYPTION_KEY_ALIAS = 'faceauth_db_encryption_key';

const STORAGE_KEYS = {
  ENROLLMENTS: 'enrollments',
  AUTH_LOGS: 'auth_logs',
  SYNC_QUEUE: 'sync_queue',
  LAST_SYNC_TIME: 'last_sync_time',
  SETTINGS: 'settings',
} as const;

// ─── Database Class ──────────────────────────────────────────────────────────

class SecureDatabase {
  private storage: MMKV | null = null;
  private initialized = false;

  /**
   * Initialize the secure database.
   * Retrieves or generates an encryption key from the device Keychain,
   * then opens the MMKV storage with that key.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get or create encryption key
      const encryptionKey = await this.getOrCreateEncryptionKey();

      // Initialize MMKV with encryption
      this.storage = createMMKV({
        id: 'faceauth-secure-db',
        encryptionKey,
      });

      this.initialized = true;
      console.log('[SecureDB] Initialized with encrypted storage');
    } catch (error) {
      console.error('[SecureDB] Initialization failed:', error);
      throw new Error(`SecureDB initialization failed: ${error}`);
    }
  }

  /**
   * Get or create the database encryption key from the device Keychain.
   * Uses hardware-backed secure storage (iOS Secure Enclave / Android Keystore).
   */
  private async getOrCreateEncryptionKey(): Promise<string> {
    try {
      // Try to retrieve existing key
      const credentials = await Keychain.getGenericPassword({
        service: KEYCHAIN_SERVICE,
      });

      if (credentials && credentials.password) {
        console.log('[SecureDB] Retrieved existing encryption key');
        return credentials.password;
      }
    } catch {
      // Key doesn't exist yet, will create below
    }

    // Generate a new random encryption key
    const key = this.generateRandomKey(32);

    // Store in Keychain
    await Keychain.setGenericPassword(ENCRYPTION_KEY_ALIAS, key, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    console.log('[SecureDB] Generated and stored new encryption key');
    return key;
  }

  /**
   * Generate a random hex string for encryption key.
   */
  private generateRandomKey(length: number): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < length * 2; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Ensure database is initialized before operations.
   */
  private ensureInitialized(): MMKV {
    if (!this.storage) {
      throw new Error('SecureDB not initialized. Call initialize() first.');
    }
    return this.storage;
  }

  // ─── Enrollment Operations ───────────────────────────────────────────────

  /**
   * Save a new enrollment record.
   */
  saveEnrollment(record: EnrollmentRecord): void {
    const storage = this.ensureInitialized();
    const enrollments = this.getAllEnrollments();
    enrollments.push(record);
    storage.set(STORAGE_KEYS.ENROLLMENTS, JSON.stringify(enrollments));
    console.log(`[SecureDB] Saved enrollment: ${record.name} (${record.id})`);

    // Add to sync queue
    this.addToSyncQueue('enrollment', record.id, record);
  }

  /**
   * Get all enrollment records.
   */
  getAllEnrollments(): EnrollmentRecord[] {
    const storage = this.ensureInitialized();
    const data = storage.getString(STORAGE_KEYS.ENROLLMENTS);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Get a specific enrollment by ID.
   */
  getEnrollment(id: string): EnrollmentRecord | undefined {
    return this.getAllEnrollments().find(e => e.id === id);
  }

  /**
   * Delete an enrollment by ID.
   */
  deleteEnrollment(id: string): void {
    const storage = this.ensureInitialized();
    const enrollments = this.getAllEnrollments().filter(e => e.id !== id);
    storage.set(STORAGE_KEYS.ENROLLMENTS, JSON.stringify(enrollments));
    console.log(`[SecureDB] Deleted enrollment: ${id}`);
  }

  /**
   * Get count of enrolled users.
   */
  getEnrollmentCount(): number {
    return this.getAllEnrollments().length;
  }

  // ─── Auth Log Operations ─────────────────────────────────────────────────

  /**
   * Save an authentication log entry.
   */
  saveAuthLog(record: AuthLogRecord): void {
    const storage = this.ensureInitialized();
    const logs = this.getAuthLogs();
    logs.push(record);
    // Keep only last 1000 logs
    const trimmed = logs.slice(-1000);
    storage.set(STORAGE_KEYS.AUTH_LOGS, JSON.stringify(trimmed));

    // Add to sync queue
    this.addToSyncQueue('auth_log', record.id, record);
  }

  /**
   * Get recent authentication logs.
   */
  getAuthLogs(limit?: number): AuthLogRecord[] {
    const storage = this.ensureInitialized();
    const data = storage.getString(STORAGE_KEYS.AUTH_LOGS);
    const logs: AuthLogRecord[] = data ? JSON.parse(data) : [];
    return limit ? logs.slice(-limit) : logs;
  }

  // ─── Sync Queue Operations ───────────────────────────────────────────────

  /**
   * Add an item to the sync queue.
   */
  private addToSyncQueue(
    recordType: 'enrollment' | 'auth_log',
    recordId: string,
    payload: object,
  ): void {
    const storage = this.ensureInitialized();
    const queue = this.getSyncQueue();
    queue.push({
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      recordType,
      recordId,
      createdAt: Date.now(),
      payload: JSON.stringify(payload),
    });
    storage.set(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  }

  /**
   * Get all items in the sync queue.
   */
  getSyncQueue(): SyncQueueItem[] {
    const storage = this.ensureInitialized();
    const data = storage.getString(STORAGE_KEYS.SYNC_QUEUE);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Remove synced items from the queue.
   */
  removeSyncedItems(ids: string[]): void {
    const storage = this.ensureInitialized();
    const queue = this.getSyncQueue().filter(item => !ids.includes(item.id));
    storage.set(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  }

  /**
   * Get count of pending sync items.
   */
  getPendingSyncCount(): number {
    return this.getSyncQueue().length;
  }

  // ─── Sync Timestamp ──────────────────────────────────────────────────────

  /**
   * Record the last successful sync time.
   */
  setLastSyncTime(timestamp: number): void {
    const storage = this.ensureInitialized();
    storage.set(STORAGE_KEYS.LAST_SYNC_TIME, timestamp);
  }

  /**
   * Get the last successful sync time.
   */
  getLastSyncTime(): number | null {
    const storage = this.ensureInitialized();
    const time = storage.getNumber(STORAGE_KEYS.LAST_SYNC_TIME);
    return time !== undefined ? time : null;
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  /**
   * Save app settings.
   */
  saveSetting(key: string, value: string | number | boolean): void {
    const storage = this.ensureInitialized();
    const settings = this.getAllSettings();
    settings[key] = value;
    storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  /**
   * Get a setting value.
   */
  getSetting<T = string | number | boolean>(key: string, defaultValue: T): T {
    const settings = this.getAllSettings();
    return (settings[key] as T) ?? defaultValue;
  }

  /**
   * Get all settings.
   */
  private getAllSettings(): Record<string, any> {
    const storage = this.ensureInitialized();
    const data = storage.getString(STORAGE_KEYS.SETTINGS);
    return data ? JSON.parse(data) : {};
  }

  // ─── Maintenance ─────────────────────────────────────────────────────────

  /**
   * Mark enrollment records as synced.
   */
  markEnrollmentsSynced(ids: string[]): void {
    const storage = this.ensureInitialized();
    const enrollments = this.getAllEnrollments().map(e =>
      ids.includes(e.id) ? { ...e, synced: true } : e,
    );
    storage.set(STORAGE_KEYS.ENROLLMENTS, JSON.stringify(enrollments));
  }

  /**
   * Mark auth log records as synced.
   */
  markAuthLogsSynced(ids: string[]): void {
    const storage = this.ensureInitialized();
    const logs = this.getAuthLogs().map(l =>
      ids.includes(l.id) ? { ...l, synced: true } : l,
    );
    storage.set(STORAGE_KEYS.AUTH_LOGS, JSON.stringify(logs));
  }

  /**
   * Purge synced data older than the specified age.
   * @param maxAgeMs Maximum age in milliseconds (default: 30 days)
   */
  purgeSyncedData(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const storage = this.ensureInitialized();
    const cutoff = Date.now() - maxAgeMs;
    let purgedCount = 0;

    // Purge old synced auth logs
    const logs = this.getAuthLogs();
    const keptLogs = logs.filter(l => {
      if (l.synced && l.timestamp < cutoff) {
        purgedCount++;
        return false;
      }
      return true;
    });
    storage.set(STORAGE_KEYS.AUTH_LOGS, JSON.stringify(keptLogs));

    console.log(`[SecureDB] Purged ${purgedCount} synced records`);
    return purgedCount;
  }

  /**
   * Clear all data (for testing or user-initiated reset).
   */
  clearAll(): void {
    const storage = this.ensureInitialized();
    storage.clearAll();
    console.log('[SecureDB] All data cleared');
  }

  /**
   * Get storage statistics.
   */
  getStorageStats(): {
    enrollmentCount: number;
    authLogCount: number;
    pendingSyncCount: number;
    lastSyncTime: number | null;
  } {
    return {
      enrollmentCount: this.getEnrollmentCount(),
      authLogCount: this.getAuthLogs().length,
      pendingSyncCount: this.getPendingSyncCount(),
      lastSyncTime: this.getLastSyncTime(),
    };
  }
}

// Export singleton instance
export const secureDB = new SecureDatabase();
export default secureDB;
