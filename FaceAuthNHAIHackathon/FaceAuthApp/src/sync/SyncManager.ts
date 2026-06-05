/**
 * SyncManager - Offline-first data synchronization with AWS.
 *
 * Monitors network connectivity and syncs local data to AWS
 * endpoints when connectivity is restored. Implements:
 * - Connectivity monitoring via NetInfo
 * - Queue-based sync with retry logic
 * - Data purge after successful sync
 * - Background sync scheduling
 *
 * For the hackathon prototype, uses mock AWS endpoints.
 * The architecture supports real AWS Lambda + API Gateway + S3.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { secureDB, SyncQueueItem } from '../storage/SecureDB';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  timestamp: number;
  errors: string[];
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  lastSyncResult: SyncResult | null;
}

export interface SyncHistoryEntry {
  timestamp: number;
  result: SyncResult;
}

export type SyncStatusCallback = (status: SyncStatus) => void;

// ─── Configuration ───────────────────────────────────────────────────────────

const SYNC_CONFIG = {
  /** Maximum items to sync in a single batch */
  batchSize: 50,
  /** Maximum retry attempts per item */
  maxRetries: 3,
  /** Base delay for exponential backoff (ms) */
  baseRetryDelay: 1000,
  /** Auto-sync interval when online (ms) — 5 minutes */
  autoSyncInterval: 5 * 60 * 1000,
  /** Data retention period after sync (ms) — 30 days */
  purgeAfterMs: 30 * 24 * 60 * 60 * 1000,
  /** Mock API endpoint (replace with real AWS endpoint in production) */
  apiEndpoint: 'https://mock-api.faceauth.example.com',
} as const;

// ─── Mock AWS Client ─────────────────────────────────────────────────────────

/**
 * Mock AWS API client for the hackathon prototype.
 *
 * In production, this would make real HTTP requests to:
 * - AWS API Gateway → Lambda → DynamoDB for structured data
 * - AWS S3 presigned URLs for embedding blobs
 */
class AWSClient {
  private apiEndpoint: string;

  constructor(endpoint: string) {
    this.apiEndpoint = endpoint;
  }

  /**
   * Mock sync push — simulates uploading records to AWS.
   * Returns success for demonstration purposes.
   */
  async pushRecords(items: SyncQueueItem[]): Promise<{
    synced: string[];
    failed: string[];
  }> {
    // Simulate network latency
    await new Promise<void>(resolve => setTimeout(() => resolve(), 500 + Math.random() * 500));

    console.log(`[AWSClient] Pushing ${items.length} records to ${this.apiEndpoint}`);

    // In production, this would be:
    // const response = await fetch(`${this.apiEndpoint}/sync/push`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${authToken}`,
    //   },
    //   body: JSON.stringify({
    //     changes: items.map(item => ({
    //       type: item.recordType,
    //       id: item.recordId,
    //       data: JSON.parse(item.payload),
    //       createdAt: item.createdAt,
    //     })),
    //   }),
    // });
    // const result = await response.json();

    // Mock: 95% success rate per item
    const synced: string[] = [];
    const failed: string[] = [];

    for (const item of items) {
      if (Math.random() > 0.05) {
        synced.push(item.id);
      } else {
        failed.push(item.id);
      }
    }

    return { synced, failed };
  }

  /**
   * Mock sync pull — simulates downloading new enrollments from server.
   */
  async pullChanges(_lastPulledAt: number): Promise<{
    enrollments: any[];
    timestamp: number;
  }> {
    // Simulate network latency
    await new Promise<void>(resolve => setTimeout(() => resolve(), 300));

    console.log(`[AWSClient] Pulling changes since ${new Date(_lastPulledAt).toISOString()}`);

    // In production:
    // const response = await fetch(`${this.apiEndpoint}/sync/pull`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ lastPulledAt }),
    // });

    return {
      enrollments: [], // Mock: no new server-side enrollments
      timestamp: Date.now(),
    };
  }

  /**
   * Mock upload embedding to S3.
   */
  async uploadEmbedding(
    _enrollmentId: string,
    _embeddingBase64: string,
  ): Promise<string> {
    // Simulate upload
    await new Promise<void>(resolve => setTimeout(() => resolve(), 200));

    // In production:
    // 1. Get presigned URL: POST /sync/presigned-url
    // 2. Upload to S3: PUT presignedUrl with embedding data
    // 3. Return S3 key

    return `s3://faceauth-embeddings/${_enrollmentId}.bin`;
  }
}

// ─── SyncManager Class ───────────────────────────────────────────────────────

class SyncManager {
  private awsClient: AWSClient;
  private isOnline = false;
  private isSyncing = false;
  private autoSyncEnabled = true;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncResult: SyncResult | null = null;
  private syncHistory: SyncHistoryEntry[] = [];
  private statusCallbacks: Set<SyncStatusCallback> = new Set();
  private unsubscribeNetInfo: (() => void) | null = null;

  constructor() {
    this.awsClient = new AWSClient(SYNC_CONFIG.apiEndpoint);
  }

  /**
   * Initialize the sync manager.
   * Starts monitoring network connectivity and sets up auto-sync.
   */
  initialize(): void {
    // Monitor network changes
    this.unsubscribeNetInfo = NetInfo.addEventListener(
      (state: NetInfoState) => {
        const wasOffline = !this.isOnline;
        this.isOnline = state.isConnected === true;

        console.log(
          `[SyncManager] Network: ${this.isOnline ? 'ONLINE' : 'OFFLINE'}`,
        );

        // Auto-sync when coming back online
        if (wasOffline && this.isOnline && this.autoSyncEnabled) {
          console.log('[SyncManager] Back online — triggering auto-sync');
          this.sync();
        }

        this.notifyStatusChange();
      },
    );

    // Set up periodic auto-sync
    this.startAutoSync();

    console.log('[SyncManager] Initialized');
  }

  /**
   * Start periodic auto-sync when online.
   */
  private startAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }

    this.autoSyncTimer = setInterval(() => {
      if (this.isOnline && this.autoSyncEnabled && !this.isSyncing) {
        const pendingCount = secureDB.getPendingSyncCount();
        if (pendingCount > 0) {
          console.log(
            `[SyncManager] Auto-sync: ${pendingCount} pending records`,
          );
          this.sync();
        }
      }
    }, SYNC_CONFIG.autoSyncInterval);
  }

  /**
   * Perform a full sync operation.
   * Pushes local changes to server and pulls new data.
   */
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      console.log('[SyncManager] Sync already in progress');
      return this.lastSyncResult ?? {
        success: false,
        syncedCount: 0,
        failedCount: 0,
        timestamp: Date.now(),
        errors: ['Sync already in progress'],
      };
    }

    if (!this.isOnline) {
      return {
        success: false,
        syncedCount: 0,
        failedCount: 0,
        timestamp: Date.now(),
        errors: ['Device is offline'],
      };
    }

    this.isSyncing = true;
    this.notifyStatusChange();

    const errors: string[] = [];
    let syncedCount = 0;
    let failedCount = 0;

    try {
      // Step 1: Push local changes
      const queue = secureDB.getSyncQueue();
      if (queue.length > 0) {
        console.log(`[SyncManager] Pushing ${queue.length} records...`);

        // Process in batches
        for (let i = 0; i < queue.length; i += SYNC_CONFIG.batchSize) {
          const batch = queue.slice(i, i + SYNC_CONFIG.batchSize);
          let retryCount = 0;

          while (retryCount < SYNC_CONFIG.maxRetries) {
            try {
              const result = await this.awsClient.pushRecords(batch);
              syncedCount += result.synced.length;
              failedCount += result.failed.length;

              // Remove synced items from queue
              if (result.synced.length > 0) {
                secureDB.removeSyncedItems(result.synced);

                // Mark records as synced
                const enrollmentIds = batch
                  .filter(
                    item =>
                      item.recordType === 'enrollment' &&
                      result.synced.includes(item.id),
                  )
                  .map(item => item.recordId);
                const authLogIds = batch
                  .filter(
                    item =>
                      item.recordType === 'auth_log' &&
                      result.synced.includes(item.id),
                  )
                  .map(item => item.recordId);

                if (enrollmentIds.length > 0) {
                  secureDB.markEnrollmentsSynced(enrollmentIds);
                }
                if (authLogIds.length > 0) {
                  secureDB.markAuthLogsSynced(authLogIds);
                }
              }

              break; // Success — exit retry loop
            } catch (error) {
              retryCount++;
              const delay =
                SYNC_CONFIG.baseRetryDelay * Math.pow(2, retryCount);
              console.warn(
                `[SyncManager] Push failed (attempt ${retryCount}), retrying in ${delay}ms...`,
              );
              await new Promise<void>(resolve => setTimeout(() => resolve(), delay));

              if (retryCount >= SYNC_CONFIG.maxRetries) {
                errors.push(`Batch push failed after ${retryCount} retries`);
                failedCount += batch.length;
              }
            }
          }
        }
      }

      // Step 2: Pull server changes
      try {
        const lastPulledAt = secureDB.getLastSyncTime() ?? 0;
        const pullResult = await this.awsClient.pullChanges(lastPulledAt);

        if (pullResult.enrollments.length > 0) {
          console.log(
            `[SyncManager] Pulled ${pullResult.enrollments.length} new enrollments`,
          );
          // In production: merge pulled enrollments into local DB
        }
      } catch (error) {
        errors.push(`Pull failed: ${error}`);
      }

      // Step 3: Purge old synced data
      const purgedCount = secureDB.purgeSyncedData(SYNC_CONFIG.purgeAfterMs);
      if (purgedCount > 0) {
        console.log(`[SyncManager] Purged ${purgedCount} old synced records`);
      }

      // Record sync time
      secureDB.setLastSyncTime(Date.now());
    } catch (error) {
      errors.push(`Sync error: ${error}`);
    } finally {
      this.isSyncing = false;
    }

    const result: SyncResult = {
      success: errors.length === 0 && failedCount === 0,
      syncedCount,
      failedCount,
      timestamp: Date.now(),
      errors,
    };

    this.lastSyncResult = result;
    this.syncHistory.push({ timestamp: Date.now(), result });
    // Keep only last 20 history entries
    this.syncHistory = this.syncHistory.slice(-20);

    this.notifyStatusChange();
    console.log(
      `[SyncManager] Sync complete: ${syncedCount} synced, ${failedCount} failed`,
    );

    return result;
  }

  /**
   * Force purge all synced local data.
   */
  purgeAll(): number {
    return secureDB.purgeSyncedData(0); // Purge everything that's synced
  }

  // ─── Status & Subscriptions ────────────────────────────────────────────

  /**
   * Get current sync status.
   */
  getStatus(): SyncStatus {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: secureDB.getPendingSyncCount(),
      lastSyncTime: secureDB.getLastSyncTime(),
      lastSyncResult: this.lastSyncResult,
    };
  }

  /**
   * Get sync history.
   */
  getSyncHistory(): SyncHistoryEntry[] {
    return [...this.syncHistory];
  }

  /**
   * Subscribe to status changes.
   */
  subscribe(callback: SyncStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    // Immediately send current status
    callback(this.getStatus());
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of a status change.
   */
  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusCallbacks.forEach(callback => callback(status));
  }

  /**
   * Enable or disable auto-sync.
   */
  setAutoSync(enabled: boolean): void {
    this.autoSyncEnabled = enabled;
    secureDB.saveSetting('auto_sync_enabled', enabled);
    console.log(`[SyncManager] Auto-sync: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if auto-sync is enabled.
   */
  isAutoSyncEnabled(): boolean {
    return this.autoSyncEnabled;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.statusCallbacks.clear();
    console.log('[SyncManager] Disposed');
  }
}

// Export singleton instance
export const syncManager = new SyncManager();
export default syncManager;
