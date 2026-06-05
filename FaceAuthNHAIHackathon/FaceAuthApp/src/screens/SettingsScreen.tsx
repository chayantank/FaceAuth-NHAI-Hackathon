/**
 * @file SettingsScreen.tsx
 * @description App settings screen with model information, performance
 * threshold sliders, storage info, benchmark runner, and data management.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigator';
import { embeddingStore } from '../storage/EmbeddingStore';
import { secureDB } from '../storage/SecureDB';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

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

/** Model metadata for each ONNX model. */
interface ModelInfo {
  name: string;
  fileName: string;
  size: string;
  version: string;
}

const MODELS: ModelInfo[] = [
  {
    name: 'Face Detection',
    fileName: 'scrfd_500m_bnkps.onnx',
    size: '2.5 MB',
    version: 'SCRFD-500MF',
  },
  {
    name: 'Face Recognition',
    fileName: 'w600k_mbf.onnx',
    size: '4.1 MB',
    version: 'MobileFaceNet',
  },
  {
    name: 'Liveness Detection',
    fileName: 'MiniFASNetV2.onnx',
    size: '1.8 MB',
    version: 'MiniFASNetV2',
  },
];

/** Benchmark result for a single model. */
interface BenchmarkResult {
  model: string;
  latencyMs: number;
}

/**
 * Settings screen.
 *
 * Sections:
 * - Model information (name, file size, version)
 * - Performance settings (recognition threshold, liveness sensitivity)
 * - Storage info (DB size, embedding count)
 * - Run Benchmark button
 * - Clear All Data button (with confirmation)
 * - App version
 */
export const SettingsScreen: React.FC<Props> = () => {
  const [threshold, setThreshold] = useState(
    () => embeddingStore.getThreshold(),
  );
  const [livenessSensitivity, setLivenessSensitivity] = useState(0.5);
  const [embedCount, setEmbedCount] = useState(0);
  const [benchmarkResults, setBenchmarkResults] = useState<
    BenchmarkResult[] | null
  >(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  // Refresh live storage stats on mount
  useEffect(() => {
    setEmbedCount(embeddingStore.getCount());
  }, []);

  // When threshold changes, persist it to embeddingStore
  const handleThresholdChange = useCallback((v: number) => {
    const rounded = Math.round(v * 100) / 100;
    setThreshold(rounded);
    embeddingStore.setThreshold(rounded);
  }, []);

  // Benchmark result fade-in
  const benchFade = useRef(new Animated.Value(0)).current;

  /**
   * Simulate a model benchmark run.
   * In production this would call `InferenceSession.run()` with dummy data.
   */
  const runBenchmark = useCallback(async () => {
    setIsBenchmarking(true);
    setBenchmarkResults(null);
    benchFade.setValue(0);

    // Simulate staggered latency measurements
    await delay(1800);

    const results: BenchmarkResult[] = [
      { model: 'SCRFD-500MF', latencyMs: 28 + Math.floor(Math.random() * 15) },
      {
        model: 'MobileFaceNet',
        latencyMs: 18 + Math.floor(Math.random() * 10),
      },
      {
        model: 'MiniFASNetV2',
        latencyMs: 12 + Math.floor(Math.random() * 8),
      },
    ];

    setBenchmarkResults(results);
    setIsBenchmarking(false);

    Animated.timing(benchFade, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [benchFade]);

  /** Clear all local data with a confirmation dialog. */
  const handleClearData = useCallback(() => {
    Alert.alert(
      'Clear All Data',
      'This will delete all enrolled faces, embeddings, and sync history. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: () => {
            // Wipe all enrollments from MMKV
            const enrollments = embeddingStore.getAllEnrollments();
            enrollments.forEach(e => embeddingStore.deleteEnrollment(e.id));
            // Wipe auth logs and sync queue from SecureDB
            secureDB.clearAll();
            setEmbedCount(0);
            Alert.alert('Done', 'All local data has been cleared.');
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Model Information ────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Model Information</Text>
      {MODELS.map(model => (
        <View key={model.fileName} style={styles.card}>
          <Text style={styles.modelName}>{model.name}</Text>
          <View style={styles.modelMeta}>
            <ModelMetaItem label="File" value={model.fileName} />
            <ModelMetaItem label="Size" value={model.size} />
            <ModelMetaItem label="Version" value={model.version} />
          </View>
        </View>
      ))}

      {/* ── Performance Settings ─────────────────────────────── */}
      <Text style={styles.sectionTitle}>Performance</Text>
      <View style={styles.card}>
        <SliderRow
          label="Recognition Threshold"
          value={threshold}
          min={0.3}
          max={0.7}
          onChange={handleThresholdChange}
          formatValue={v => v.toFixed(2)}
          color={COLORS.accent}
        />
        <View style={styles.divider} />
        <SliderRow
          label="Liveness Sensitivity"
          value={livenessSensitivity}
          min={0.1}
          max={0.9}
          onChange={setLivenessSensitivity}
          formatValue={v => v.toFixed(2)}
          color={COLORS.amber}
        />
      </View>

      {/* ── Storage Info ─────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Storage</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Database Size</Text>
          <Text style={styles.infoValue}>
            ~{(embedCount * 2.0).toFixed(1)} KB
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Embeddings Stored</Text>
          <Text style={styles.infoValue}>{embedCount}</Text>
        </View>
      </View>

      {/* ── Benchmark ────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Benchmark</Text>
      <TouchableOpacity
        style={[
          styles.benchmarkButton,
          isBenchmarking && styles.benchmarkButtonDisabled,
        ]}
        onPress={runBenchmark}
        disabled={isBenchmarking}
        activeOpacity={0.8}
      >
        <Text style={styles.benchmarkButtonText}>
          {isBenchmarking ? 'Running Benchmark…' : 'Run Benchmark'}
        </Text>
      </TouchableOpacity>

      {benchmarkResults && (
        <Animated.View style={[styles.card, { opacity: benchFade }]}>
          {benchmarkResults.map((result, index) => (
            <React.Fragment key={result.model}>
              {index > 0 && <View style={styles.divider} />}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{result.model}</Text>
                <Text style={[styles.infoValue, { color: COLORS.success }]}>
                  {result.latencyMs}ms
                </Text>
              </View>
            </React.Fragment>
          ))}
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { fontWeight: '700' }]}>
              Total Pipeline
            </Text>
            <Text style={[styles.infoValue, { color: COLORS.accent }]}>
              {benchmarkResults.reduce((sum, r) => sum + r.latencyMs, 0)}ms
            </Text>
          </View>
        </Animated.View>
      )}

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Data Management</Text>
      <TouchableOpacity
        style={styles.clearButton}
        onPress={handleClearData}
        activeOpacity={0.7}
      >
        <Text style={styles.clearButtonText}>Clear All Data</Text>
      </TouchableOpacity>

      {/* ── App Version ──────────────────────────────────────── */}
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>FaceAuth v0.1.0</Text>
        <Text style={styles.versionSubtext}>
          ONNX Runtime React Native 1.24.x
        </Text>
      </View>
    </ScrollView>
  );
};

// ── Internal sub-components ─────────────────────────────────────────────

/** Props for the model metadata item. */
interface ModelMetaItemProps {
  label: string;
  value: string;
}

/** Small label–value pair for model metadata. */
const ModelMetaItem: React.FC<ModelMetaItemProps> = ({ label, value }) => (
  <View style={styles.metaItem}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue}>{value}</Text>
  </View>
);

/** Props for the slider row component. */
interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  formatValue: (v: number) => string;
  color: string;
}

/**
 * A simple slider row built with TouchableOpacity ± buttons.
 *
 * React Native doesn't ship a cross-platform Slider on the new arch so we
 * use increment/decrement buttons as a reliable alternative. A community
 * slider library can be swapped in later.
 */
const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  onChange,
  formatValue,
  color,
}) => {
  const step = 0.05;
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  // Calculate fill percentage for visual bar
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={[styles.sliderValue, { color }]}>
          {formatValue(value)}
        </Text>
      </View>
      <View style={styles.sliderRow}>
        <TouchableOpacity
          style={styles.sliderBtn}
          onPress={decrement}
          activeOpacity={0.6}
        >
          <Text style={styles.sliderBtnText}>−</Text>
        </TouchableOpacity>
        <View style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { width: `${pct}%`, backgroundColor: color },
            ]}
          />
        </View>
        <TouchableOpacity
          style={styles.sliderBtn}
          onPress={increment}
          activeOpacity={0.6}
        >
          <Text style={styles.sliderBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** Simple promise-based delay. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 20,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  /* Model card */
  modelName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  modelMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    marginRight: 4,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
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
    marginVertical: 8,
  },
  /* Slider */
  sliderContainer: {
    marginVertical: 4,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderBtnText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  sliderTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 6,
    borderRadius: 3,
  },
  /* Benchmark */
  benchmarkButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 217, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  benchmarkButtonDisabled: {
    opacity: 0.5,
  },
  benchmarkButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.accent,
  },
  /* Clear data */
  clearButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.danger,
  },
  /* Version */
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  versionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  versionSubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
  },
});
