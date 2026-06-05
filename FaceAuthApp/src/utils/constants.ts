/**
 * @file constants.ts
 * @description Application-wide constants for the FaceAuth ML pipeline.
 */

/** Minimum confidence score to keep a detected face from SCRFD. */
export const DETECTION_CONFIDENCE_THRESHOLD = 0.5;

/** IoU threshold for Non-Maximum Suppression during face detection. */
export const NMS_IOU_THRESHOLD = 0.4;

/** Cosine-similarity threshold for face-match decisions. */
export const RECOGNITION_THRESHOLD = 0.45;

/** Score threshold for passive liveness (MiniFASNetV2). */
export const LIVENESS_THRESHOLD = 0.5;

/** Minimum face bounding-box side length (px) to consider a face usable. */
export const FACE_QUALITY_MIN_SIZE = 80;

/** Maximum Laplacian variance; above this the image is considered too blurry. */
export const FACE_QUALITY_MAX_BLUR = 100;

/** Number of frames averaged during enrollment for a stable template. */
export const ENROLLMENT_NUM_FRAMES = 5;

/** Model-specific square input sizes (width = height). */
export const MODEL_INPUT_SIZES = {
  detection: 640,
  recognition: 112,
  liveness: 80,
} as const;

/**
 * Standard ArcFace alignment reference landmarks for a 112×112 crop.
 * Order: left-eye, right-eye, nose, left-mouth, right-mouth.
 */
export const ARCFACE_REFERENCE_LANDMARKS: readonly [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** SCRFD stride levels for multi-scale anchor decoding. */
export const SCRFD_STRIDES = [8, 16, 32] as const;

/** Number of anchors per spatial location in SCRFD-500MF. */
export const SCRFD_ANCHORS_PER_LOCATION = 2;

/** Eye Aspect Ratio threshold below which a blink is detected. */
export const EAR_BLINK_THRESHOLD = 0.2;

/** Consecutive low-EAR frames required before a blink is confirmed. */
export const EAR_CONSEC_FRAMES = 2;

/** Head-turn displacement threshold as a fraction of face width. */
export const HEAD_TURN_THRESHOLD = 0.15;

/** Model asset filenames (INT8 quantized for minimal footprint). */
export const MODEL_FILES = {
  detection: 'det_500m.onnx',
  recognition: 'w600k_mbf.onnx',
  liveness: 'minifasnet_v2.onnx',
} as const;
