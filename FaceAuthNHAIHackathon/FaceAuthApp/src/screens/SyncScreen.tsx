/**
 * @file SyncScreen.tsx
 * @description Sync management screen with network status, pending records,
 * sync controls, progress bar, sync history, and data purge.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigator';
import { StatusBadge } from '../components/StatusBadge';
import { secureDB, AuthLogRecord } from '../storage/SecureDB';
import { embeddingStore } from '../storage/EmbeddingStore';
import { syncManager } from '../sync/SyncManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Sync'>;

/** Represents a single sync history event. */
interface SyncEvent {
  id: string;
  timestamp: string;
  recordsSynced: number;
  status: 'success' | 'error';
}

const COLORS = {
  bg: '#0B1120',
  accent: '#00D9FF',
  amber: '#FFB800',
  success: '#00E676',
  danger: '#FF5252',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.55)',
  cardBg: 'rgba(255, 255, 255, 0.06)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
};

/** Placeholder sync history for demonstration. */
const INITIAL_HISTORY: SyncEvent[] = [
  {
    id: '1',
    timestamp: '2025-05-24 14:32',
    recordsSynced: 3,
    status: 'success',
  },
  {
    id: '2',
    timestamp: '2025-05-23 09:15',
    recordsSynced: 7,
    status: 'success',
  },
  {
    id: '3',
    timestamp: '2025-05-22 18:44',
    recordsSynced: 0,
    status: 'error',
  },
];

/**
 * Sync management screen.
 *
 * Displays network status, pending record count, last sync time, a "Sync Now"
 * button with progress animation, sync history, auto-sync toggle, and a
 * data purge option.
 */
export const SyncScreen: React.FC<Props> = ({ navigation }) => {
  const [isOnline, setIsOnline] = useState(false);
  const [pendingRecords, setPendingRecords] = useState(0);
  const [lastSync, setLastSync] = useState('Never');
  const [isSyncing, setIsSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [history, setHistory] = useState<SyncEvent[]>([]);

  // Load actual data
  const loadData = useCallback(() => {
    const enrollments = embeddingStore.getAllEnrollments();
    const unsyncedEnrollments = enrollments.filter(e => !e.synced).length;
    // Also count unsynced auth logs
    const authLogs = secureDB.getAuthLogs();
    const unsyncedLogs = authLogs.filter((l: AuthLogRecord) => !l.synced).length;
    setPendingRecords(unsyncedEnrollments + unsyncedLogs);
    
    const lastSyncTime = secureDB.getLastSyncTime();
    if (lastSyncTime) {
      const d = new Date(lastSyncTime);
      setLastSync(d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }));
    }
  }, []);

  useEffect(() => {
    loadData();
    // Add focus listener to refresh when navigating back
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [loadData, navigation]);

  // Sync progress animation (0 → 1)
  const syncProgress = useRef(new Animated.Value(0)).current;

  // Subscribe to network changes
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });
    return () => unsubscribe();
  }, []);

  /**
   * Perform a real sync via SyncManager, with animated progress bar.
   */
  const handleSync = useCallback(async () => {
    if (!isOnline || isSyncing) {
      return;
    }

    setIsSyncing(true);
    syncProgress.setValue(0);

    // Start progress animation (will finish when sync completes)
    Animated.timing(syncProgress, {
      toValue: 0.9, // Run to 90% during sync, jump to 100% on finish
      duration: 2000,
      useNativeDriver: false,
    }).start();

    try {
      const result = await syncManager.sync();

      // Jump to 100%
      Animated.timing(syncProgress, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();

      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const newEvent: SyncEvent = {
        id: Date.now().toString(),
        timestamp: now,
        recordsSynced: result.syncedCount,
        status: result.success ? 'success' : 'error',
      };

      setHistory(prev => [newEvent, ...prev].slice(0, 10));
      setPendingRecords(0);
      setLastSync(now);
    } catch {
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const errorEvent: SyncEvent = {
        id: Date.now().toString(),
        timestamp: now,
        recordsSynced: 0,
        status: 'error',
      };
      setHistory(prev => [errorEvent, ...prev].slice(0, 10));
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, syncProgress]);

  /** Prompt confirmation then purge local data. */
  const handlePurge = useCallback(() => {
    Alert.alert(
      'Purge Local Data',
      'This will remove all locally cached enrollments. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge',
          style: 'destructive',
          onPress: () => {
            const enrollments = embeddingStore.getAllEnrollments();
            enrollments.forEach(e => embeddingStore.deleteEnrollment(e.id));
            setHistory([]);
            setPendingRecords(0);
          },
        },
      ],
    );
  }, []);

  /** Render a single sync history row. */
  const renderHistoryItem = useCallback(
    ({ item }: { item: SyncEvent }) => (
      <View style={styles.historyItem}>
        <View
          style={[
            styles.historyDot,
            {
              backgroundColor:
                item.status === 'success' ? COLORS.success : COLORS.danger,
            },
          ]}
        />
        <View style={styles.historyContent}>
          <Text style={styles.historyTimestamp}>{item.timestamp}</Text>
          <Text style={styles.historyDetail}>
            {item.status === 'success'
              ? `${item.recordsSynced} record${item.recordsSynced !== 1 ? 's' : ''} synced`
              : 'Sync failed'}
          </Text>
        </View>
      </View>
    ),
    [],
  );

  // Animated width for progress bar
  const progressWidth = syncProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Network Status Card ──────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Network Status</Text>
          <StatusBadge
            status={isOnline ? 'online' : 'offline'}
            label={isOnline ? 'Online' : 'Offline'}
          />
        </View>
      </View>

      {/* ── Sync Info Card ───────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Pending Records</Text>
          <Text
            style={[
              styles.infoValue,
              { color: pendingRecords > 0 ? COLORS.amber : COLORS.success },
            ]}
          >
            {pendingRecords}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Sync</Text>
          <Text style={styles.infoValue}>{lastSync}</Text>
        </View>
      </View>

      {/* ── Sync Button + Progress ───────────────────────────── */}
      <TouchableOpacity
        style={[
          styles.syncButton,
          (!isOnline || isSyncing) && styles.syncButtonDisabled,
        ]}
        onPress={handleSync}
        disabled={!isOnline || isSyncing}
        activeOpacity={0.8}
      >
        <Text style={styles.syncButtonText}>
          {isSyncing ? 'Syncing…' : 'Sync Now'}
        </Text>
      </TouchableOpacity>

      {isSyncing && (
        <View style={styles.progressBarBg}>
          <Animated.View
            style={[styles.progressBarFill, { width: progressWidth }]}
          />
        </View>
      )}

      {/* ── Auto-Sync Toggle ─────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View>
            <Text style={styles.toggleLabel}>Auto-Sync</Text>
            <Text style={styles.toggleSub}>
              Sync automatically when online
            </Text>
          </View>
          <Switch
            value={autoSync}
            onValueChange={setAutoSync}
            trackColor={{
              false: 'rgba(255,255,255,0.12)',
              true: 'rgba(0, 217, 255, 0.4)',
            }}
            thumbColor={autoSync ? COLORS.accent : '#888'}
          />
        </View>
      </View>

      {/* ── Sync History ─────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Sync History</Text>
        <Text style={styles.sectionSubtitle}>Last 10 events</Text>
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No sync history</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          renderItem={renderHistoryItem}
          keyExtractor={item => item.id}
          scrollEnabled={false}
          style={styles.historyList}
        />
      )}

      {/* ── Purge Button ─────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.purgeButton}
        onPress={handlePurge}
        activeOpacity={0.7}
      >
        <Text style={styles.purgeButtonText}>Purge Local Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  /* Card */
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  /* Info rows */
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 6,
  },
  /* Sync button */
  syncButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  syncButtonDisabled: {
    backgroundColor: 'rgba(0, 217, 255, 0.25)',
  },
  syncButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.bg,
  },
  /* Progress bar */
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  /* Toggle */
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  toggleSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  /* Section */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  /* History */
  historyList: {
    marginBottom: 20,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 14,
  },
  historyContent: {
    flex: 1,
  },
  historyTimestamp: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  historyDetail: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  /* Purge */
  purgeButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purgeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.danger,
  },
});
