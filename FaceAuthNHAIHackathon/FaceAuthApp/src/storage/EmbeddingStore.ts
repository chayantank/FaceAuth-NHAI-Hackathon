/**
 * EmbeddingStore - Manages face embedding storage and matching.
 *
 * Provides CRUD operations for face embeddings and efficient
 * cosine similarity search for face matching.
 *
 * Embeddings are stored as Base64-encoded Float32Arrays in the
 * encrypted SecureDB. No raw images are ever stored.
 */

import { secureDB, EnrollmentRecord } from './SecureDB';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MatchResult {
  /** Matched enrollment record, or null if no match */
  enrollment: EnrollmentRecord | null;
  /** Cosine similarity score (-1 to 1) */
  similarity: number;
  /** Whether the similarity exceeds the threshold */
  isMatch: boolean;
  /** Time taken for the search in milliseconds */
  searchTimeMs: number;
}

export interface EnrollmentInput {
  name: string;
  /** Array of embeddings from multiple frames */
  embeddings: Float32Array[];
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Convert a Float32Array to a Base64 string for storage.
 */
export function embeddingToBase64(embedding: Float32Array): string {
  const bytes = new Uint8Array(embedding.buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[c & 63] : '=';
  }
  return result;
}

/**
 * Convert a Base64 string back to a Float32Array.
 */
export function base64ToEmbedding(base64: string): Float32Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Remove padding
  const cleaned = base64.replace(/=+$/, '');
  const byteLength = Math.floor((cleaned.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0, j = 0; i < cleaned.length; i += 4, j += 3) {
    const a = chars.indexOf(cleaned[i]);
    const b = chars.indexOf(cleaned[i + 1]);
    const c = i + 2 < cleaned.length ? chars.indexOf(cleaned[i + 2]) : 0;
    const d = i + 3 < cleaned.length ? chars.indexOf(cleaned[i + 3]) : 0;
    bytes[j] = (a << 2) | (b >> 4);
    if (j + 1 < byteLength) bytes[j + 1] = ((b & 15) << 4) | (c >> 2);
    if (j + 2 < byteLength) bytes[j + 2] = ((c & 3) << 6) | d;
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in range [-1, 1] where 1 = identical.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Average multiple embedding vectors into a single representative embedding.
 * Used during enrollment to create robust templates from multiple frames.
 */
export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) {
    throw new Error('Cannot average zero embeddings');
  }

  const dim = embeddings[0].length;
  const result = new Float32Array(dim);

  for (const embedding of embeddings) {
    if (embedding.length !== dim) {
      throw new Error(`Dimension mismatch: expected ${dim}, got ${embedding.length}`);
    }
    for (let i = 0; i < dim; i++) {
      result[i] += embedding[i];
    }
  }

  // Average
  for (let i = 0; i < dim; i++) {
    result[i] /= embeddings.length;
  }

  // L2 normalize the averaged embedding
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += result[i] * result[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      result[i] /= norm;
    }
  }

  return result;
}

// ─── EmbeddingStore Class ────────────────────────────────────────────────────

class EmbeddingStore {
  private defaultThreshold = 0.45;

  /**
   * Enroll a new user with multiple face embeddings.
   *
   * Takes multiple embeddings (from different frames/angles),
   * averages them into a single robust template, and stores it.
   *
   * @param input - Name and array of embeddings
   * @returns The created enrollment record
   */
  enroll(input: EnrollmentInput): EnrollmentRecord {
    const { name, embeddings } = input;

    if (embeddings.length === 0) {
      throw new Error('At least one embedding is required for enrollment');
    }

    // Average embeddings for a robust template
    const averagedEmbedding = averageEmbeddings(embeddings);

    // Create enrollment record
    const record: EnrollmentRecord = {
      id: `enroll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      embeddingBase64: embeddingToBase64(averagedEmbedding),
      enrolledAt: Date.now(),
      synced: false,
      frameCount: embeddings.length,
    };

    // Save to encrypted storage
    secureDB.saveEnrollment(record);

    console.log(
      `[EmbeddingStore] Enrolled: ${name} (${embeddings.length} frames, ${averagedEmbedding.length}-dim)`,
    );

    return record;
  }

  /**
   * Search for a matching face among all enrolled users.
   *
   * Performs brute-force cosine similarity comparison against all
   * stored embeddings. For <1000 users this is fast enough (<5ms).
   *
   * @param queryEmbedding - The embedding to search for
   * @param threshold - Similarity threshold for a match (default: 0.45)
   * @returns The best match result
   */
  findMatch(
    queryEmbedding: Float32Array,
    threshold?: number,
  ): MatchResult {
    const startTime = Date.now();
    const matchThreshold = threshold ?? this.defaultThreshold;

    const enrollments = secureDB.getAllEnrollments();

    let bestMatch: EnrollmentRecord | null = null;
    let bestSimilarity = -1;

    for (const enrollment of enrollments) {
      try {
        const storedEmbedding = base64ToEmbedding(enrollment.embeddingBase64);
        const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = enrollment;
        }
      } catch (error) {
        console.warn(
          `[EmbeddingStore] Error comparing with ${enrollment.name}:`,
          error,
        );
      }
    }

    const searchTimeMs = Date.now() - startTime;

    return {
      enrollment: bestSimilarity >= matchThreshold ? bestMatch : null,
      similarity: bestSimilarity,
      isMatch: bestSimilarity >= matchThreshold,
      searchTimeMs,
    };
  }

  /**
   * Get all enrolled users.
   */
  getAllEnrollments(): EnrollmentRecord[] {
    return secureDB.getAllEnrollments();
  }

  /**
   * Delete an enrollment by ID.
   */
  deleteEnrollment(id: string): void {
    secureDB.deleteEnrollment(id);
  }

  /**
   * Get enrollment count.
   */
  getCount(): number {
    return secureDB.getEnrollmentCount();
  }

  /**
   * Set the default recognition threshold.
   */
  setThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0 and 1');
    }
    this.defaultThreshold = threshold;
    secureDB.saveSetting('recognition_threshold', threshold);
  }

  /**
   * Get the current recognition threshold.
   */
  getThreshold(): number {
    return secureDB.getSetting<number>(
      'recognition_threshold',
      this.defaultThreshold,
    );
  }
}

// Export singleton instance
export const embeddingStore = new EmbeddingStore();
export default embeddingStore;
