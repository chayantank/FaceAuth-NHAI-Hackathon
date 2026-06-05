/**
 * @file cosine.ts
 * @description Vector math utilities used by the face-recognition pipeline.
 */

/**
 * Compute the cosine similarity between two vectors.
 *
 * @param a - First vector (Float32Array).
 * @param b - Second vector (Float32Array), must have the same length as `a`.
 * @returns Cosine similarity in the range [-1, 1].
 * @throws {Error} If the vectors have different lengths or zero magnitude.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    throw new Error('Cannot compute cosine similarity for zero-magnitude vector');
  }

  return dot / denom;
}

/**
 * L2-normalize a vector in-place and return a **new** normalized copy.
 *
 * @param vec - Input vector.
 * @returns A new Float32Array with unit L2 norm.
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }

  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(vec.length);

  if (norm === 0) {
    return out; // all-zero vector stays zero
  }

  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }

  return out;
}

/**
 * Compute the Euclidean (L2) distance between two vectors.
 *
 * @param a - First vector.
 * @param b - Second vector, same length as `a`.
 * @returns The Euclidean distance (>= 0).
 * @throws {Error} If the vectors have different lengths.
 */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSq += diff * diff;
  }

  return Math.sqrt(sumSq);
}
