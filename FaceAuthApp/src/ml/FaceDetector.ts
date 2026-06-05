/**
 * @file FaceDetector.ts
 * @description Face detection powered by SCRFD-500MF.
 *
 * SCRFD outputs predictions at three stride levels (8, 16, 32).
 * For each stride the model produces:
 *   • **scores**    — (num_anchors × 1) raw logits
 *   • **bboxes**    — (num_anchors × 4) deltas [dx, dy, dw, dh]
 *   • **keypoints** — (num_anchors × 10) five 2D landmarks
 *
 * Post-processing: sigmoid → confidence filter → coordinate decode → NMS.
 */

import { Tensor } from 'onnxruntime-react-native';
import type { InferenceSession } from 'onnxruntime-react-native';

import { ModelManager } from './ModelManager';
import { normalizeImage, resizeImage } from './preprocessing';
import {
  DETECTION_CONFIDENCE_THRESHOLD,
  MODEL_INPUT_SIZES,
  NMS_IOU_THRESHOLD,
  SCRFD_STRIDES,
  SCRFD_ANCHORS_PER_LOCATION,
} from '../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single face detection result. */
export interface Detection {
  /** Bounding box in the coordinate space of the *original* input image. */
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  /** Five facial landmarks `[[x,y], …]` (left-eye, right-eye, nose, mouth-L, mouth-R). */
  landmarks: number[][];
  /** Detection confidence ∈ (0, 1). */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Helper: sigmoid
// ---------------------------------------------------------------------------

/** Element-wise sigmoid. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ---------------------------------------------------------------------------
// Helper: IoU & NMS
// ---------------------------------------------------------------------------

/**
 * Intersection-over-Union between two axis-aligned bounding boxes.
 */
function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;

  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);

  return inter / (areaA + areaB - inter + 1e-6);
}

/**
 * Non-Maximum Suppression — keep highest-confidence detections that do not
 * overlap more than `iouThreshold`.
 */
function nms(detections: Detection[], iouThreshold: number): Detection[] {
  // Sort descending by confidence.
  const sorted = [...detections].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const kept: Detection[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(sorted[i].bbox, sorted[j].bbox) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Generate SCRFD anchors
// ---------------------------------------------------------------------------

/**
 * Build the (x, y) anchor centre grid for a single stride level.
 *
 * @param featH     - Feature-map height.
 * @param featW     - Feature-map width.
 * @param stride    - Stride (8 | 16 | 32).
 * @param numAnchors - Anchors per spatial location (typically 2).
 * @returns Array of `[cx, cy]` anchor centres in input-image coordinates.
 */
function generateAnchors(
  featH: number,
  featW: number,
  stride: number,
  numAnchors: number,
): number[][] {
  const anchors: number[][] = [];
  for (let row = 0; row < featH; row++) {
    for (let col = 0; col < featW; col++) {
      const cx = (col + 0.5) * stride;
      const cy = (row + 0.5) * stride;
      for (let a = 0; a < numAnchors; a++) {
        anchors.push([cx, cy]);
      }
    }
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Decode one stride level
// ---------------------------------------------------------------------------

/**
 * Decode raw model outputs for a single stride level into `Detection` objects.
 *
 * @param scores     - Raw score logits (flat Float32Array, length N).
 * @param bboxDeltas - Bbox distance predictions (flat, N×4).
 * @param kpsDeltas  - Keypoint predictions (flat, N×10).
 * @param anchors    - Anchor centres for this stride.
 * @param stride     - Stride value.
 * @param scaleX     - Horizontal scale factor to map back to original image.
 * @param scaleY     - Vertical scale factor.
 * @param threshold  - Confidence threshold.
 * @returns Filtered detections before NMS.
 */
function decodeStride(
  scores: Float32Array | number[],
  bboxDeltas: Float32Array | number[],
  kpsDeltas: Float32Array | number[],
  anchors: number[][],
  stride: number,
  scaleX: number,
  scaleY: number,
  threshold: number,
): Detection[] {
  const results: Detection[] = [];
  const n = anchors.length;

  for (let i = 0; i < n; i++) {
    const conf = sigmoid(scores[i] as number);
    if (conf < threshold) continue;

    const cx = anchors[i][0];
    const cy = anchors[i][1];

    // SCRFD distance format: left, top, right, bottom distances from anchor centre.
    const dl = bboxDeltas[i * 4 + 0] * stride;
    const dt = bboxDeltas[i * 4 + 1] * stride;
    const dr = bboxDeltas[i * 4 + 2] * stride;
    const db = bboxDeltas[i * 4 + 3] * stride;

    const x1 = (cx - dl) * scaleX;
    const y1 = (cy - dt) * scaleY;
    const x2 = (cx + dr) * scaleX;
    const y2 = (cy + db) * scaleY;

    // Decode keypoints (5 landmarks, each [dx, dy] relative to anchor).
    const landmarks: number[][] = [];
    for (let k = 0; k < 5; k++) {
      const lx = (cx + kpsDeltas[i * 10 + k * 2] * stride) * scaleX;
      const ly = (cy + kpsDeltas[i * 10 + k * 2 + 1] * stride) * scaleY;
      landmarks.push([lx, ly]);
    }

    results.push({
      bbox: [x1, y1, x2, y2],
      landmarks,
      confidence: conf,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect faces in an RGB image using the SCRFD-500MF model.
 *
 * @param imageData - RGB pixel buffer (Uint8Array, 3 bytes/pixel, row-major).
 * @param width     - Image width in pixels.
 * @param height    - Image height in pixels.
 * @param confidenceThreshold - Override default confidence threshold.
 * @param iouThreshold        - Override default NMS IoU threshold.
 * @returns Array of detected faces with bounding boxes, landmarks, and scores.
 */
export async function detectFaces(
  imageData: Uint8Array,
  width: number,
  height: number,
  confidenceThreshold: number = DETECTION_CONFIDENCE_THRESHOLD,
  iouThreshold: number = NMS_IOU_THRESHOLD,
): Promise<Detection[]> {
  const session: InferenceSession = ModelManager.getInstance().getDetectionSession();
  const inputSize = MODEL_INPUT_SIZES.detection; // 640

  // 1. Resize to model input size.
  const resized = resizeImage(imageData, width, height, inputSize, inputSize);

  // 2. Normalize to NCHW float32 (zero-one for SCRFD).
  const normalized = normalizeImage(resized, inputSize, inputSize, 'zeroOne');

  // 3. Create input tensor and run inference.
  const inputName =
    session.inputNames.length > 0 ? session.inputNames[0] : 'input.1';
  const tensor = new Tensor('float32', normalized, [1, 3, inputSize, inputSize]);
  const output = await session.run({ [inputName]: tensor });

  // 4. Decode outputs per stride level.
  //    SCRFD-500MF output names follow the pattern:
  //      score_<stride>, bbox_<stride>, kps_<stride>
  //    Fallback: use ordered outputNames if exact pattern isn't found.
  const scaleX = width / inputSize;
  const scaleY = height / inputSize;
  const allDetections: Detection[] = [];

  const outputNames = session.outputNames;

  // Try named-output strategy first; fall back to positional.
  let decoded = false;

  for (let si = 0; si < SCRFD_STRIDES.length; si++) {
    const stride = SCRFD_STRIDES[si];
    const featSize = inputSize / stride;

    // Attempt to find outputs by conventional names.
    const scoreName = outputNames.find(
      (n) => n.includes('score') && n.includes(String(stride)),
    ) ?? outputNames.find(
      (n) => n.includes('score') && n.includes(`_${si}`),
    );
    const bboxName = outputNames.find(
      (n) => n.includes('bbox') && n.includes(String(stride)),
    ) ?? outputNames.find(
      (n) => n.includes('bbox') && n.includes(`_${si}`),
    );
    const kpsName = outputNames.find(
      (n) => n.includes('kps') && n.includes(String(stride)),
    ) ?? outputNames.find(
      (n) => n.includes('kps') && n.includes(`_${si}`),
    );

    if (scoreName && bboxName && kpsName) {
      const scores = output[scoreName].data as Float32Array;
      const bboxes = output[bboxName].data as Float32Array;
      const kps = output[kpsName].data as Float32Array;

      const anchors = generateAnchors(
        featSize,
        featSize,
        stride,
        SCRFD_ANCHORS_PER_LOCATION,
      );

      allDetections.push(
        ...decodeStride(
          scores, bboxes, kps, anchors, stride, scaleX, scaleY, confidenceThreshold,
        ),
      );
      decoded = true;
    }
  }

  // Positional fallback: outputs come in groups of 3 per stride
  // (score, bbox, kps) ordered by stride ascending.
  if (!decoded && outputNames.length >= SCRFD_STRIDES.length * 3) {
    for (let si = 0; si < SCRFD_STRIDES.length; si++) {
      const stride = SCRFD_STRIDES[si];
      const featSize = inputSize / stride;

      const scores = output[outputNames[si * 3]].data as Float32Array;
      const bboxes = output[outputNames[si * 3 + 1]].data as Float32Array;
      const kps = output[outputNames[si * 3 + 2]].data as Float32Array;

      const anchors = generateAnchors(
        featSize,
        featSize,
        stride,
        SCRFD_ANCHORS_PER_LOCATION,
      );

      allDetections.push(
        ...decodeStride(
          scores, bboxes, kps, anchors, stride, scaleX, scaleY, confidenceThreshold,
        ),
      );
    }
  }

  // 5. Apply NMS.
  return nms(allDetections, iouThreshold);
}
