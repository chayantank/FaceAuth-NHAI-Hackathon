/**
 * @file FaceRecognizer.ts
 * @description Face recognition (embedding extraction + comparison) using
 * MobileFaceNet (w600k_mbf).
 *
 * Pipeline:
 * 1. Receive an aligned 112×112 face crop (from `alignFace()`).
 * 2. Normalize pixels to [−1, 1] (ArcFace convention).
 * 3. Run MobileFaceNet inference → 512-dim raw embedding.
 * 4. L2-normalize the embedding.
 */

import { Tensor } from 'onnxruntime-react-native';
import type { InferenceSession } from 'onnxruntime-react-native';

import { ModelManager } from './ModelManager';
import { normalizeImage } from './preprocessing';
import { cosineSimilarity, l2Normalize } from '../utils/cosine';
import { MODEL_INPUT_SIZES, RECOGNITION_THRESHOLD } from '../utils/constants';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a 512-dimensional face embedding from an aligned 112×112 image.
 *
 * @param alignedFace - RGB pixel data of the aligned face (Uint8Array,
 *                      3 bytes/pixel, row-major, 112×112).
 * @param width       - Face image width  (expected 112).
 * @param height      - Face image height (expected 112).
 * @returns L2-normalized 512-dim embedding.
 */
export async function extractEmbedding(
  alignedFace: Uint8Array,
  width: number,
  height: number,
): Promise<Float32Array> {
  if (width !== MODEL_INPUT_SIZES.recognition || height !== MODEL_INPUT_SIZES.recognition) {
    throw new Error(
      `extractEmbedding: expected ${MODEL_INPUT_SIZES.recognition}×${MODEL_INPUT_SIZES.recognition} input, ` +
      `got ${width}×${height}`,
    );
  }

  const session: InferenceSession =
    ModelManager.getInstance().getRecognitionSession();

  // ArcFace normalization: (pixel − 127.5) / 127.5 → [−1, 1]
  const normalized = normalizeImage(alignedFace, width, height, 'centered');

  const inputName =
    session.inputNames.length > 0 ? session.inputNames[0] : 'input';
  const tensor = new Tensor('float32', normalized, [1, 3, height, width]);
  const result = await session.run({ [inputName]: tensor });

  // The first (and usually only) output contains the raw embedding.
  const outputName = session.outputNames[0];
  const rawEmbedding = result[outputName].data as Float32Array;

  // L2-normalize so cosine similarity equals the dot product.
  return l2Normalize(rawEmbedding);
}

/**
 * Compute the similarity between two face embeddings.
 *
 * Both embeddings should already be L2-normalized (as returned by
 * {@link extractEmbedding}), so the cosine similarity equals the dot product.
 *
 * @param embedding1 - First 512-dim embedding.
 * @param embedding2 - Second 512-dim embedding.
 * @returns Cosine similarity in [−1, 1].
 */
export function compareFaces(
  embedding1: Float32Array,
  embedding2: Float32Array,
): number {
  return cosineSimilarity(embedding1, embedding2);
}

/**
 * Decide whether two faces belong to the same person.
 *
 * @param similarity - Cosine similarity value (output of {@link compareFaces}).
 * @param threshold  - Match threshold; defaults to {@link RECOGNITION_THRESHOLD} (0.45).
 * @returns `true` if `similarity >= threshold`.
 */
export function isMatch(
  similarity: number,
  threshold: number = RECOGNITION_THRESHOLD,
): boolean {
  return similarity >= threshold;
}
