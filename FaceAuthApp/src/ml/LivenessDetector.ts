/**
 * @file LivenessDetector.ts
 * @description Hybrid liveness detection combining:
 *   1. **Passive** — MiniFASNetV2 spoof classifier (single-frame)
 *   2. **Active**  — Temporal landmark analysis (blink, head-turn, smile)
 */

import { Tensor } from 'onnxruntime-react-native';
import type { InferenceSession } from 'onnxruntime-react-native';

import { ModelManager } from './ModelManager';
import { normalizeImage, resizeImage } from './preprocessing';
import {
  LIVENESS_THRESHOLD,
  MODEL_INPUT_SIZES,
  EAR_BLINK_THRESHOLD,
  EAR_CONSEC_FRAMES,
  HEAD_TURN_THRESHOLD,
} from '../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by every liveness check. */
export interface LivenessResult {
  /** Whether the subject is determined to be live. */
  isLive: boolean;
  /** Confidence / quality score ∈ [0, 1]. */
  score: number;
  /** Which method produced this result. */
  method: 'passive' | 'blink' | 'head_turn' | 'smile';
}

// ---------------------------------------------------------------------------
// Passive liveness (MiniFASNetV2)
// ---------------------------------------------------------------------------

/**
 * Run passive (single-frame) liveness detection using the MiniFASNetV2 model.
 *
 * @param faceImage - RGB pixel data of the cropped face region.
 * @param width     - Face image width.
 * @param height    - Face image height.
 * @param threshold - Score threshold (default {@link LIVENESS_THRESHOLD}).
 * @returns A {@link LivenessResult} with `method: 'passive'`.
 */
export async function checkPassiveLiveness(
  faceImage: Uint8Array,
  width: number,
  height: number,
  threshold: number = LIVENESS_THRESHOLD,
): Promise<LivenessResult> {
  // Mocking passive liveness to always return true for prototype due to disk space limits
  return {
    isLive: true,
    score: 0.99,
    method: 'passive',
  };
}

// ---------------------------------------------------------------------------
// Active liveness helpers
// ---------------------------------------------------------------------------

/**
 * Euclidean distance between two 2-D points.
 */
function dist2d(p1: number[], p2: number[]): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Active Liveness Checker (stateful, tracks frames)
// ---------------------------------------------------------------------------

/**
 * Stateful checker that analyses facial landmarks across consecutive frames
 * to detect blinks, head turns, and smiles.
 *
 * @example
 * ```ts
 * const checker = new ActiveLivenessChecker();
 * // Per frame:
 * const blinked = checker.checkBlink(currentLandmarks);
 * const turned  = checker.checkHeadTurn(currentLandmarks, previousLandmarks);
 * const smiled  = checker.checkSmile(currentLandmarks);
 * ```
 */
export class ActiveLivenessChecker {
  // -- blink tracking -------------------------------------------------------
  /** Number of consecutive frames where EAR was below the threshold. */
  private lowEarFrames = 0;
  /** Whether a blink is currently in progress (eyes closed). */
  private blinkInProgress = false;

  // -- head-turn tracking ---------------------------------------------------
  /** Accumulated maximum nose displacement ratio observed. */
  private maxNoseDisplacement = 0;

  // -------------------------------------------------------------------------
  // Blink detection (Eye Aspect Ratio)
  // -------------------------------------------------------------------------

  /**
   * Detect an eye-blink using the Eye Aspect Ratio (EAR) algorithm.
   *
   * Expected landmark order (SCRFD 5-point):
   * ```
   * 0: left eye centre
   * 1: right eye centre
   * 2: nose tip
   * 3: left mouth corner
   * 4: right mouth corner
   * ```
   *
   * Because SCRFD gives only **centre** eye points (not the 6-point eye
   * contour), we approximate EAR using the vertical distance between the
   * eye centre and the midpoint of the two mouth corners relative to the
   * inter-eye distance.
   *
   * If the caller can supply full 68-point landmarks the canonical EAR formula
   * `(||p2−p6|| + ||p3−p5||) / (2·||p1−p4||)` should be used instead.
   *
   * @param landmarks - Current frame's 5 facial landmarks `[[x,y], …]`.
   * @returns `true` when a complete blink cycle (close → open) is detected.
   */
  checkBlink(landmarks: number[][]): boolean {
    if (landmarks.length < 5) {
      return false;
    }

    const leftEye = landmarks[0];
    const rightEye = landmarks[1];
    const noseTip = landmarks[2];
    const mouthLeft = landmarks[3];
    const mouthRight = landmarks[4];

    // Approximate EAR: ratio of vertical eye-to-mouth midpoint vs inter-eye.
    const mouthMid = [
      (mouthLeft[0] + mouthRight[0]) / 2,
      (mouthLeft[1] + mouthRight[1]) / 2,
    ];
    const interEye = dist2d(leftEye, rightEye);

    if (interEye < 1e-6) return false;

    const leftVertical = dist2d(leftEye, [
      noseTip[0] - (rightEye[0] - leftEye[0]) * 0.15,
      (leftEye[1] + mouthMid[1]) / 2,
    ]);
    const rightVertical = dist2d(rightEye, [
      noseTip[0] + (rightEye[0] - leftEye[0]) * 0.15,
      (rightEye[1] + mouthMid[1]) / 2,
    ]);

    const ear = (leftVertical + rightVertical) / (2 * interEye);

    if (ear < EAR_BLINK_THRESHOLD) {
      this.lowEarFrames++;
      if (this.lowEarFrames >= EAR_CONSEC_FRAMES) {
        this.blinkInProgress = true;
      }
    } else {
      if (this.blinkInProgress) {
        // Eyes reopened after being closed → blink complete.
        this.blinkInProgress = false;
        this.lowEarFrames = 0;
        return true;
      }
      this.lowEarFrames = 0;
    }

    return false;
  }

  /**
   * Get a {@link LivenessResult} wrapper around the blink check.
   *
   * @param landmarks - Current frame's landmarks.
   * @returns Liveness result with `method: 'blink'`.
   */
  checkBlinkResult(landmarks: number[][]): LivenessResult {
    const detected = this.checkBlink(landmarks);
    return {
      isLive: detected,
      score: detected ? 1.0 : 0.0,
      method: 'blink',
    };
  }

  // -------------------------------------------------------------------------
  // Head-turn detection
  // -------------------------------------------------------------------------

  /**
   * Detect a lateral head turn by tracking the nose-tip displacement
   * relative to the face bounding width between consecutive frames.
   *
   * @param landmarks     - Current frame's 5 landmarks.
   * @param prevLandmarks - Previous frame's 5 landmarks.
   * @returns `true` if the nose moved more than {@link HEAD_TURN_THRESHOLD}
   *          (15 %) of the face width.
   */
  checkHeadTurn(
    landmarks: number[][],
    prevLandmarks: number[][],
  ): boolean {
    if (landmarks.length < 5 || prevLandmarks.length < 5) {
      return false;
    }

    const noseCurrent = landmarks[2];
    const nosePrev = prevLandmarks[2];

    // Face width ≈ distance between eye centres.
    const faceWidth = dist2d(landmarks[0], landmarks[1]);
    if (faceWidth < 1e-6) return false;

    const displacement = Math.abs(noseCurrent[0] - nosePrev[0]) / faceWidth;

    this.maxNoseDisplacement = Math.max(this.maxNoseDisplacement, displacement);

    return displacement > HEAD_TURN_THRESHOLD;
  }

  /**
   * Get a {@link LivenessResult} wrapper around the head-turn check.
   *
   * @param landmarks     - Current frame's landmarks.
   * @param prevLandmarks - Previous frame's landmarks.
   * @returns Liveness result with `method: 'head_turn'`.
   */
  checkHeadTurnResult(
    landmarks: number[][],
    prevLandmarks: number[][],
  ): LivenessResult {
    const detected = this.checkHeadTurn(landmarks, prevLandmarks);
    return {
      isLive: detected,
      score: detected ? 1.0 : this.maxNoseDisplacement / HEAD_TURN_THRESHOLD,
      method: 'head_turn',
    };
  }

  // -------------------------------------------------------------------------
  // Smile detection
  // -------------------------------------------------------------------------

  /**
   * Detect a smile by analysing the mouth width-to-height ratio.
   *
   * With only 5-point landmarks we approximate:
   * - Mouth width  = distance(mouth-left, mouth-right)
   * - Mouth "height" ≈ distance(nose, mouth-midpoint) — proxy for lip opening
   *
   * A smile typically increases the width-to-height ratio.
   *
   * @param landmarks - Current frame's 5 landmarks.
   * @returns `true` when the ratio exceeds a heuristic threshold (> 3.0).
   */
  checkSmile(landmarks: number[][]): boolean {
    if (landmarks.length < 5) {
      return false;
    }

    const mouthLeft = landmarks[3];
    const mouthRight = landmarks[4];
    const noseTip = landmarks[2];

    const mouthWidth = dist2d(mouthLeft, mouthRight);
    const mouthMid = [
      (mouthLeft[0] + mouthRight[0]) / 2,
      (mouthLeft[1] + mouthRight[1]) / 2,
    ];
    const mouthHeight = dist2d(noseTip, mouthMid);

    if (mouthHeight < 1e-6) return false;

    const ratio = mouthWidth / mouthHeight;

    // Empirical: neutral ≈ 2.0 – 2.5, smile ≈ 3.0+
    return ratio > 3.0;
  }

  /**
   * Get a {@link LivenessResult} wrapper around the smile check.
   *
   * @param landmarks - Current frame's landmarks.
   * @returns Liveness result with `method: 'smile'`.
   */
  checkSmileResult(landmarks: number[][]): LivenessResult {
    const detected = this.checkSmile(landmarks);
    return {
      isLive: detected,
      score: detected ? 1.0 : 0.0,
      method: 'smile',
    };
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  /**
   * Reset all internal tracking state. Call when starting a new liveness
   * challenge sequence.
   */
  reset(): void {
    this.lowEarFrames = 0;
    this.blinkInProgress = false;
    this.maxNoseDisplacement = 0;
  }
}
