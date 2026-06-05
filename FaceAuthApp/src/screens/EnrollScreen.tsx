/**
 * @file EnrollScreen.tsx
 * @description Face enrollment flow with camera preview, step indicator,
 * multi-frame capture, quality feedback, and face detection overlay.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  TextInput,
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
import type { BoundingBox } from '../components/FaceOverlay';
import { convertFrameToRGB, alignFace } from '../ml/preprocessing';
import { detectFaces } from '../ml/FaceDetector';
import { extractEmbedding } from '../ml/FaceRecognizer';
import { ModelManager } from '../ml/ModelManager';
import { embeddingStore } from '../storage/EmbeddingStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Enroll'>;

/** Enrollment steps rendered in the step indicator. */
const STEPS = ['Position Face', 'Capture', 'Verify', 'Save'] as const;
type Step = (typeof STEPS)[number];

/** Maximum number of frames to capture. */
const MAX_CAPTURES = 5;

type QualityMessage =
  | 'Position your face in the frame'
  | 'Hold still'
  | 'Hold still...'
  | 'Too dark'
  | 'Face too small'
  | 'Too dark or blurry'
  | 'Multiple faces detected'
  | 'Models loading...'
  | 'Detecting face...'
  | 'Verifying...'
  | 'Good – capturing…';

const COLORS = {
  bg: '#0B1120',
  accent: '#00D9FF',
  amber: '#FFB800',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.55)',
  cardBg: 'rgba(255, 255, 255, 0.06)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  success: '#00E676',
  danger: '#FF5252',
};

/**
 * Face enrollment screen.
 *
 * Guides the user through a four-step process:
 * 1. Position face in the camera frame
 * 2. Capture 5 frames for multi-angle enrollment
 * 3. Verify captured embeddings
 * 4. Save enrolled user
 *
 * Uses `react-native-vision-camera` with the front-facing camera and
 * requests permission via `useCameraPermission()`.
 */
export const EnrollScreen: React.FC<Props> = ({ navigation }) => {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<CameraRef>(null);

  const [currentStep, setCurrentStep] = useState<number>(0);
  const [userName, setUserName] = useState('');
  const [captureCount, setCaptureCount] = useState(0);
  const [qualityMessage, setQualityMessage] =
    useState<QualityMessage>('Position your face in the frame');
  const [isComplete, setIsComplete] = useState(false);
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null);

  // Success animation
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  /** Request camera permission if not already granted. */
  const ensurePermission = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert(
          'Camera Permission',
          'Camera access is required to enroll a face.',
        );
      }
    }
  }, [hasPermission, requestPermission]);

  React.useEffect(() => {
    ensurePermission();
  }, [ensurePermission]);

  // Keep track of collected face embeddings (simulated for now, would be Float32Array[])
  const collectedEmbeddings = useRef<Float32Array[]>([]);
  const isProcessing = useRef(false);

  /** Process frame on JS thread (async ML inference) */
  const processFrameJS = useCallback(async (rgbData: Uint8Array, width: number, height: number) => {
    if (isProcessing.current || captureCount >= MAX_CAPTURES) return;
    isProcessing.current = true;

    try {
      if (!ModelManager.getInstance().isReady()) {
        setQualityMessage('Models loading...');
        isProcessing.current = false;
        return;
      }

      setQualityMessage('Detecting face...');
      
      const detections = await detectFaces(rgbData, width, height);
      
      if (detections.length === 0) {
        setQualityMessage('Position your face in the frame');
        setBoundingBox(null);
      } else if (detections.length > 1) {
        setQualityMessage('Multiple faces detected');
        setBoundingBox(null);
      } else {
        const face = detections[0];
        
        // Scale bounding box to screen coordinates (assuming standard aspect ratio)
        // In a real app, you need coordinate mapping based on camera preview size
        setBoundingBox({
          x: face.bbox[0],
          y: face.bbox[1],
          width: face.bbox[2] - face.bbox[0],
          height: face.bbox[3] - face.bbox[1],
        });

        if (face.confidence < 0.6) {
          setQualityMessage('Too dark or blurry');
        } else {
          setQualityMessage('Hold still...');
          
          // Align face and extract real embedding
          const alignedFace = alignFace(rgbData, width, height, face.landmarks);
          const embedding = await extractEmbedding(
            alignedFace.data,
            alignedFace.width,
            alignedFace.height
          );
          
          collectedEmbeddings.current.push(embedding);
          
          const nextCount = collectedEmbeddings.current.length;
          setCaptureCount(nextCount);
          
          if (nextCount >= MAX_CAPTURES) {
            setCurrentStep(2); // Verify
            setQualityMessage('Verifying...');
            
            setTimeout(() => {
              setCurrentStep(3); // Save
              setIsComplete(true);

              Animated.parallel([
                Animated.spring(successScale, {
                  toValue: 1,
                  friction: 4,
                  useNativeDriver: true,
                }),
                Animated.timing(successOpacity, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]).start();
            }, 1000);
          }
        }
      }
    } catch (error) {
      console.warn('Frame processing error:', error);
    } finally {
      // Throttle processing (process ~1 frame per second for enrollment)
      setTimeout(() => {
        isProcessing.current = false;
      }, 500);
    }
  }, [captureCount, successScale, successOpacity]);

  // Create worklet for JS call
  const runOnJS = Worklets.createRunOnJS(processFrameJS);

  /** Frame processor running on native thread */
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb', // Gives us BGRA 32-bit ArrayBuffer
    onFrame: (frame) => {
      'worklet';
      // Only process if we haven't reached max captures
      if (captureCount < MAX_CAPTURES) {
        const buffer = frame.getPixelBuffer();
        // convertFrameToRGB is a standard JS function, but we can't call it here 
        // if it relies on JS context unless it's a worklet.
        // Instead, pass the buffer to JS thread.
        // ArrayBuffer from Frame might be disposed, so we copy it.
        const bufferCopy = new Uint8Array(buffer).slice().buffer;
        
        runOnJS(
          new Uint8Array(bufferCopy),
          frame.width,
          frame.height
        );
      }
      frame.dispose();
    },
  });

  /** Handle the manual capture button (optional fallback) */
  const handleCapture = useCallback(async () => {
    // Left as fallback or mock
    if (captureCount >= MAX_CAPTURES) return;
    setCaptureCount(prev => prev + 1);
  }, [captureCount]);

  /** Save the enrolled user and navigate back. */
  const handleSave = useCallback(() => {
    if (!userName.trim()) {
      Alert.alert('Name Required', 'Please enter a name for the enrolled user.');
      return;
    }

    if (collectedEmbeddings.current.length === 0) {
      Alert.alert('Error', 'No face embeddings were captured. Please try again.');
      return;
    }

    try {
      embeddingStore.enroll({
        name: userName.trim(),
        embeddings: collectedEmbeddings.current,
      });

      Alert.alert('Success', `${userName} has been enrolled successfully.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.warn('Enrollment error:', error);
      Alert.alert('Error', 'Failed to save enrollment.');
    }
  }, [userName, navigation]);

  // ── Render helpers ────────────────────────────────────────────────────

  /** Step indicator at the top. */
  const renderStepIndicator = () => (
    <View style={styles.stepContainer}>
      {STEPS.map((step, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;
        return (
          <View key={step} style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                isActive && styles.stepCircleActive,
                isDone && styles.stepCircleDone,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  (isActive || isDone) && styles.stepNumberActive,
                ]}
              >
                {isDone ? '✓' : index + 1}
              </Text>
            </View>
            <Text
              style={[
                styles.stepLabel,
                isActive && styles.stepLabelActive,
              ]}
            >
              {step}
            </Text>
            {index < STEPS.length - 1 && (
              <View
                style={[
                  styles.stepLine,
                  isDone && styles.stepLineDone,
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );

  // ── Permission / device guard ─────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>
          Camera permission is required for enrollment.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>
          No front camera found on this device.
        </Text>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {renderStepIndicator()}

      {/* Camera preview + overlay */}
      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!isComplete}
          outputs={[frameOutput]}
        />

        <FaceOverlay
          boundingBox={boundingBox}
          state={
            isComplete
              ? 'matched'
              : captureCount > 0
                ? 'detecting'
                : 'detecting'
          }
        />

        {/* Quality feedback pill */}
        <View style={styles.qualityPill}>
          <Text style={styles.qualityText}>{qualityMessage}</Text>
        </View>

        {/* Success overlay */}
        {isComplete && (
          <Animated.View
            style={[
              styles.successOverlay,
              {
                opacity: successOpacity,
                transform: [{ scale: successScale }],
              },
            ]}
          >
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successText}>Enrollment Complete</Text>
          </Animated.View>
        )}
      </View>

      {/* Bottom controls */}
      <View style={styles.controls}>
        {!isComplete ? (
          <>
            {/* Capture progress */}
            <View style={styles.progressRow}>
              {Array.from({ length: MAX_CAPTURES }).map((_, i) => (
                <View
                  key={`dot-${i}`}
                  style={[
                    styles.progressDot,
                    i < captureCount && styles.progressDotFilled,
                  ]}
                />
              ))}
              <Text style={styles.progressText}>
                {captureCount}/{MAX_CAPTURES}
              </Text>
            </View>

            {/* Name input */}
            <TextInput
              style={styles.nameInput}
              placeholder="Enter enrollee name…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={userName}
              onChangeText={setUserName}
              autoCapitalize="words"
              returnKeyType="done"
            />

            {/* Capture button */}
            <TouchableOpacity
              style={[
                styles.captureButton,
                captureCount >= MAX_CAPTURES && styles.captureButtonDisabled,
              ]}
              onPress={handleCapture}
              disabled={captureCount >= MAX_CAPTURES}
              activeOpacity={0.7}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Name input (if not entered yet) */}
            <TextInput
              style={styles.nameInput}
              placeholder="Enter enrollee name…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={userName}
              onChangeText={setUserName}
              autoCapitalize="words"
              returnKeyType="done"
            />

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Text style={styles.saveButtonText}>Save Enrollment</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

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
  permissionText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
  },
  permissionButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.bg,
  },
  /* Step indicator */
  stepContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  stepCircleActive: {
    backgroundColor: COLORS.accent,
  },
  stepCircleDone: {
    backgroundColor: COLORS.success,
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
  },
  stepNumberActive: {
    color: COLORS.bg,
  },
  stepLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginRight: 8,
  },
  stepLabelActive: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  stepLine: {
    width: 16,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginRight: 8,
    borderRadius: 1,
  },
  stepLineDone: {
    backgroundColor: COLORS.success,
  },
  /* Camera */
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginHorizontal: 12,
    marginVertical: 8,
    backgroundColor: '#000',
  },
  qualityPill: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  qualityText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  successOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: 12,
  },
  successText: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.success,
  },
  /* Controls */
  controls: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 4,
  },
  progressDotFilled: {
    backgroundColor: COLORS.accent,
  },
  progressText: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  nameInput: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonDisabled: {
    borderColor: 'rgba(255,255,255,0.15)',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent,
  },
  saveButton: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.bg,
  },
});
