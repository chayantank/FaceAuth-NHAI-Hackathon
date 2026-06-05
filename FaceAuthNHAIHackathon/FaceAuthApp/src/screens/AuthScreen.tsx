/**
 * @file AuthScreen.tsx
 * @description Face authentication screen with camera preview, circular face
 * guide, liveness challenge prompts, real-time status text, and animated
 * result transitions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import type { CameraRef } from 'react-native-vision-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Worklets } from 'react-native-worklets-core';

import type { RootStackParamList } from '../navigation/AppNavigator';
import { FaceOverlay } from '../components/FaceOverlay';
import type { DetectionState } from '../components/FaceOverlay';
import { convertFrameToRGB, cropFace, alignFace } from '../ml/preprocessing';
import { detectFaces } from '../ml/FaceDetector';
import { checkPassiveLiveness, ActiveLivenessChecker } from '../ml/LivenessDetector';
import { extractEmbedding, compareFaces } from '../ml/FaceRecognizer';
import { ModelManager } from '../ml/ModelManager';
import { embeddingStore } from '../storage/EmbeddingStore';
import { secureDB } from '../storage/SecureDB';

type Props = NativeStackScreenProps<RootStackParamList, 'Authenticate'>;

/** Authentication pipeline phases. */
type AuthPhase =
  | 'idle'
  | 'detecting'
  | 'liveness'
  | 'matching'
  | 'success'
  | 'failure';

/** Liveness challenges that can be displayed. */
const LIVENESS_CHALLENGES = [
  'Please blink',
  'Turn head left',
  'Turn head right',
  'Smile',
] as const;

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

/** Maps pipeline phase to a human-readable status label. */
const PHASE_LABELS: Record<AuthPhase, string> = {
  idle: 'Tap to begin authentication',
  detecting: 'Detecting face…',
  liveness: 'Checking liveness…',
  matching: 'Matching…',
  success: 'Identity Verified',
  failure: 'Not Recognized',
};

/**
 * Face authentication screen.
 *
 * Walks through the authentication pipeline in real-time:
 * 1. Detect face
 * 2. Run liveness challenge
 * 3. Match embedding against enrolled database
 * 4. Show animated result (checkmark / X)
 */
export const AuthScreen: React.FC<Props> = ({ navigation }) => {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<CameraRef>(null);

  const [phase, setPhase] = useState<AuthPhase>('idle');
  const [livenessChallenge, setLivenessChallenge] = useState<string>('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [matchedName, setMatchedName] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [enrolledCount, setEnrolledCount] = useState(0);

  // Initialize models on mount
  useEffect(() => {
    const init = async () => {
      try {
        const mgr = ModelManager.getInstance();
        if (!mgr.isReady()) {
          await mgr.initialize();
        }
        setModelReady(true);
        setEnrolledCount(embeddingStore.getCount());
      } catch (e) {
        console.warn('[AuthScreen] Model init failed:', e);
      }
    };
    init();
  }, []);

  // Animations
  const guideScale = useRef(new Animated.Value(1)).current;
  const resultScale = useRef(new Animated.Value(0)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const statusOpacity = useRef(new Animated.Value(1)).current;

  // Pulsing guide ring animation
  useEffect(() => {
    if (phase === 'detecting' || phase === 'liveness') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(guideScale, {
            toValue: 1.06,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(guideScale, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
  }, [phase, guideScale]);

  /** Request camera permission on mount. */
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  /** Derive overlay detection state from auth phase. */
  const overlayState: DetectionState =
    phase === 'success'
      ? 'matched'
      : phase === 'failure'
        ? 'rejected'
        : 'detecting';

  /** Play the result entrance animation. */
  const showResult = useCallback(() => {
    Animated.parallel([
      Animated.spring(resultScale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.timing(resultOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [resultScale, resultOpacity]);

  // Active Liveness state
  const activeLiveness = useRef(new ActiveLivenessChecker());
  const activeLivenessPassed = useRef(false);
  const currentChallengeRef = useRef<string>('');
  const prevLandmarksRef = useRef<number[][] | null>(null);

  /** Reset to idle state for a new attempt. */
  const resetAuth = useCallback(() => {
    setPhase('idle');
    setConfidence(null);
    setLatencyMs(null);
    setMatchedName(null);
    setLivenessChallenge('');
    currentChallengeRef.current = '';
    activeLivenessPassed.current = false;
    prevLandmarksRef.current = null;
    activeLiveness.current.reset();
    resultScale.setValue(0);
    resultOpacity.setValue(0);
    statusOpacity.setValue(1);
    // Refresh enrolled count in case user enrolled someone
    setEnrolledCount(embeddingStore.getCount());
  }, [resultScale, resultOpacity, statusOpacity]);

  const isProcessingFrame = useRef(false);

  /** Process frame on JS thread for authentication */
  const processAuthFrameJS = useCallback(async (rgbData: Uint8Array, width: number, height: number) => {
    if (phase !== 'detecting' && phase !== 'liveness' && phase !== 'matching') return;
    if (isProcessingFrame.current) return;
    
    isProcessingFrame.current = true;
    const startTime = Date.now();

    try {
      if (!ModelManager.getInstance().isReady()) {
        isProcessingFrame.current = false;
        return;
      }

      // Step 1: Detect face
      setPhase('detecting');
      const detections = await detectFaces(rgbData, width, height);
      
      if (detections.length === 0) {
        // No face
        isProcessingFrame.current = false;
        return;
      }

      const face = detections[0];
      
      // We found a face, transition to liveness if in detecting phase
      if (phase === 'detecting') {
        setPhase('liveness');
        isProcessingFrame.current = false;
        return;
      }

      let livenessScoreForLog = 1.0;

      if (phase === 'liveness') {
        // Step 2a: Active Liveness (blocking)
        if (!activeLivenessPassed.current) {
          let passed = false;
          const challenge = currentChallengeRef.current;
          
          if (challenge === 'Please blink') {
            passed = activeLiveness.current.checkBlink(face.landmarks);
          } else if (challenge === 'Smile') {
            passed = activeLiveness.current.checkSmile(face.landmarks);
          } else if (challenge === 'Turn head left' || challenge === 'Turn head right') {
            if (prevLandmarksRef.current) {
              passed = activeLiveness.current.checkHeadTurn(face.landmarks, prevLandmarksRef.current);
            }
          }
          
          prevLandmarksRef.current = face.landmarks;
          
          if (!passed) {
            // Keep waiting for user to pass the challenge
            isProcessingFrame.current = false;
            return;
          }
          
          // User passed the active challenge!
          activeLivenessPassed.current = true;
        }

        // Step 2b: Passive Liveness (CNN)
        // crop face for liveness
        const croppedFace = cropFace(rgbData, width, height, face.bbox);
        const livenessResult = await checkPassiveLiveness(
          croppedFace.data,
          croppedFace.width,
          croppedFace.height
        );
        
        livenessScoreForLog = livenessResult.score;

        if (!livenessResult.isLive || livenessResult.score < 0.5) {
          setPhase('failure');
          setConfidence(0); // spoof
          setLatencyMs(Date.now() - startTime);
          
          secureDB.saveAuthLog({
            id: `auth_${Date.now()}`,
            userId: null,
            timestamp: Date.now(),
            result: 'spoof_detected',
            livenessScore: livenessResult.score,
            similarityScore: 0,
            latencyMs: Date.now() - startTime,
            synced: false,
          });

          showResult();
          return;
        }

        // Liveness fully passed, proceed to matching
        setPhase('matching');
      }

      // Step 3: Matching (if we just transitioned to matching or are already in matching)
      if (phase === 'matching' || activeLivenessPassed.current) {
        // align face using landmarks before extracting embedding
        const alignedFace = alignFace(rgbData, width, height, face.landmarks);
        const currentEmbedding = await extractEmbedding(
          alignedFace.data,
          alignedFace.width,
          alignedFace.height
        );
      
        // Match against local DB
        const matchResult = embeddingStore.findMatch(currentEmbedding);
        
        const elapsed = Date.now() - startTime;
        setLatencyMs(elapsed);
        
        if (matchResult.isMatch && matchResult.enrollment) {
          setPhase('success');
          setConfidence(matchResult.similarity);
          setMatchedName(matchResult.enrollment.name);
          
          // Log success
          secureDB.saveAuthLog({
            id: `auth_${Date.now()}`,
            userId: matchResult.enrollment.id,
            timestamp: Date.now(),
            result: 'match',
            livenessScore: livenessScoreForLog,
            similarityScore: matchResult.similarity,
            latencyMs: elapsed,
            synced: false,
          });
        } else {
          setPhase('failure');
          setConfidence(matchResult.similarity);
          
          // Log failure
          secureDB.saveAuthLog({
            id: `auth_${Date.now()}`,
            userId: matchResult.enrollment?.id || null,
            timestamp: Date.now(),
            result: 'no_match',
            livenessScore: livenessScoreForLog,
            similarityScore: matchResult.similarity,
            latencyMs: elapsed,
            synced: false,
          });
        }
        
        showResult();
      }
      
    } catch (error) {
      console.warn('Auth processing error:', error);
      setPhase('idle');
    } finally {
      setTimeout(() => {
        isProcessingFrame.current = false;
      }, 300);
    }
  }, [phase, showResult]);

  const runOnJS = Worklets.createRunOnJS(processAuthFrameJS);

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    onFrame: (frame) => {
      'worklet';
      // Only process when auth is active
      const buffer = frame.getPixelBuffer();
      const bufferCopy = new Uint8Array(buffer).slice().buffer;
      runOnJS(
        new Uint8Array(bufferCopy),
        frame.width,
        frame.height
      );
      frame.dispose();
    },
  });

  const startAuth = useCallback(() => {
    if (!modelReady) {
      return;
    }
    if (enrolledCount === 0) {
      // Alert the user that no one is enrolled yet
      return;
    }
    resetAuth();
    
    // Pick a random challenge
    const challenge =
      LIVENESS_CHALLENGES[
        Math.floor(Math.random() * LIVENESS_CHALLENGES.length)
      ];
    setLivenessChallenge(challenge);
    currentChallengeRef.current = challenge;
    
    setPhase('detecting');
  }, [resetAuth, modelReady, enrolledCount]);

  // ── Permission / device guard ─────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.guardText}>
          Camera permission is required for authentication.
        </Text>
        <TouchableOpacity style={styles.guardButton} onPress={requestPermission}>
          <Text style={styles.guardButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.guardText}>
          No front camera found on this device.
        </Text>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  const isProcessing =
    phase === 'detecting' || phase === 'liveness' || phase === 'matching';
  const hasResult = phase === 'success' || phase === 'failure';
  const guideColor =
    phase === 'success'
      ? COLORS.success
      : phase === 'failure'
        ? COLORS.danger
        : COLORS.accent;

  return (
    <View style={styles.root}>
      {/* Camera preview */}
      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          outputs={[frameOutput]}
        />

        {/* Circular guide */}
        <View style={styles.guideWrapper}>
          <Animated.View
            style={[
              styles.guideRing,
              {
                borderColor: guideColor,
                transform: [{ scale: guideScale }],
              },
            ]}
          />
        </View>

        {/* Face overlay (shown when detecting or has result) */}
        {(isProcessing || hasResult) && (
          <FaceOverlay
            boundingBox={{ x: 110, y: 140, width: 210, height: 260 }}
            landmarks={[
              { x: 170, y: 220 },
              { x: 260, y: 220 },
              { x: 215, y: 260 },
              { x: 180, y: 300 },
              { x: 250, y: 300 },
            ]}
            state={overlayState}
          />
        )}

        {/* Result overlay */}
        {hasResult && (
          <Animated.View
            style={[
              styles.resultOverlay,
              {
                opacity: resultOpacity,
                transform: [{ scale: resultScale }],
              },
            ]}
          >
            <Text style={styles.resultIcon}>
              {phase === 'success' ? '\u2713' : '\u2717'}
            </Text>
            {phase === 'success' && matchedName ? (
              <Text style={styles.matchedName}>{matchedName}</Text>
            ) : null}
            <Text
              style={[
                styles.resultTitle,
                {
                  color:
                    phase === 'success' ? COLORS.success : COLORS.danger,
                },
              ]}
            >
              {PHASE_LABELS[phase]}
            </Text>
          </Animated.View>
        )}

        {/* Liveness challenge banner */}
        {phase === 'liveness' && (
          <View style={styles.challengeBanner}>
            <Text style={styles.challengeText}>{livenessChallenge}</Text>
          </View>
        )}
      </View>

      {/* Bottom info panel */}
      <View style={styles.infoPanel}>
        {/* Status text */}
        <Animated.Text
          style={[styles.statusText, { opacity: statusOpacity }]}
        >
          {PHASE_LABELS[phase]}
        </Animated.Text>

        {/* Confidence + latency badges */}
        {hasResult && (
          <View style={styles.metricsRow}>
            <View style={styles.metricBadge}>
              <Text style={styles.metricLabel}>Confidence</Text>
              <Text
                style={[
                  styles.metricValue,
                  {
                    color:
                      phase === 'success' ? COLORS.success : COLORS.danger,
                  },
                ]}
              >
                {confidence !== null
                  ? `${(confidence * 100).toFixed(1)}%`
                  : '—'}
              </Text>
            </View>
            <View style={styles.metricBadge}>
              <Text style={styles.metricLabel}>Latency</Text>
              <Text style={[styles.metricValue, { color: COLORS.accent }]}>
                {latencyMs !== null ? `${latencyMs}ms` : '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Action button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            (isProcessing || !modelReady) && styles.actionButtonDisabled,
          ]}
          onPress={hasResult ? resetAuth : startAuth}
          disabled={isProcessing || !modelReady}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>
            {!modelReady
              ? 'Loading models…'
              : isProcessing
                ? 'Processing…'
                : enrolledCount === 0
                  ? 'No users enrolled — go enroll first'
                  : hasResult
                    ? 'Try Again'
                    : 'Start Authentication'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** Simple promise-based delay. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const GUIDE_SIZE = 260;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  guardText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  guardButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
  },
  guardButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.bg,
  },
  /* Camera */
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: '#000',
  },
  guideWrapper: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideRing: {
    width: GUIDE_SIZE,
    height: GUIDE_SIZE,
    borderRadius: GUIDE_SIZE / 2,
    borderWidth: 3,
    borderStyle: 'dashed',
  },
  resultOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  resultIcon: {
    fontSize: 72,
    fontWeight: '200',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  matchedName: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  challengeBanner: {
    position: 'absolute',
    top: 24,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 184, 0, 0.85)',
  },
  challengeText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.bg,
  },
  /* Info panel */
  infoPanel: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  metricBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  actionButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(0, 217, 255, 0.3)',
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.bg,
  },
});
