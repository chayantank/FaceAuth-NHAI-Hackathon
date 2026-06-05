/**
 * @file preprocessing.ts
 * @description Image preprocessing utilities for the ML pipeline.
 * Handles resizing, normalization, cropping, face alignment, and
 * Frame processing from VisionCamera.
 */

// Import type for Frame from VisionCamera (only used for types)
import type { Frame } from 'react-native-vision-camera';

import { ARCFACE_REFERENCE_LANDMARKS } from '../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a face crop / alignment operation. */
export interface ProcessedImage {
  /** Raw RGB pixel data. */
  data: Uint8Array;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Convert an RGB uint8 image to a Float32Array in **NCHW** layout.
 *
 * Two normalisation modes are supported:
 * - `'zeroOne'`  → pixel / 255  (range [0, 1])
 * - `'centered'` → (pixel − 127.5) / 127.5  (range [−1, 1])
 *
 * @param imageData - Flat RGB pixel array (length = width × height × 3).
 * @param width     - Image width.
 * @param height    - Image height.
 * @param mode      - Normalisation mode, defaults to `'centered'`.
 * @returns Float32Array of shape [1, 3, height, width].
 */
export function normalizeImage(
  imageData: number[] | Uint8Array,
  width: number,
  height: number,
  mode: 'zeroOne' | 'centered' = 'centered',
): Float32Array {
  const pixelCount = width * height;
  if (imageData.length !== pixelCount * 3) {
    throw new Error(
      `normalizeImage: expected ${pixelCount * 3} values, got ${imageData.length}`,
    );
  }

  // Output: 1 × 3 × H × W
  const out = new Float32Array(3 * pixelCount);

  const offsetR = 0;
  const offsetG = pixelCount;
  const offsetB = 2 * pixelCount;

  for (let i = 0; i < pixelCount; i++) {
    const r = imageData[i * 3];
    const g = imageData[i * 3 + 1];
    const b = imageData[i * 3 + 2];

    if (mode === 'zeroOne') {
      out[offsetR + i] = r / 255;
      out[offsetG + i] = g / 255;
      out[offsetB + i] = b / 255;
    } else {
      // centered: [-1, 1]
      out[offsetR + i] = (r - 127.5) / 127.5;
      out[offsetG + i] = (g - 127.5) / 127.5;
      out[offsetB + i] = (b - 127.5) / 127.5;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bilinear resize
// ---------------------------------------------------------------------------

/**
 * Resize an RGB image using bilinear interpolation.
 *
 * @param imageData - Source RGB pixels (Uint8Array, 3 bytes/pixel, row-major).
 * @param srcWidth  - Source width.
 * @param srcHeight - Source height.
 * @param dstWidth  - Destination width.
 * @param dstHeight - Destination height.
 * @returns Resized RGB Uint8Array.
 */
export function resizeImage(
  imageData: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  const dst = new Uint8Array(dstWidth * dstHeight * 3);

  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcY = dy * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcHeight - 1);
    const fy = srcY - y0;

    for (let dx = 0; dx < dstWidth; dx++) {
      const srcX = dx * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const fx = srcX - x0;

      const dstIdx = (dy * dstWidth + dx) * 3;

      for (let c = 0; c < 3; c++) {
        const topLeft = imageData[(y0 * srcWidth + x0) * 3 + c];
        const topRight = imageData[(y0 * srcWidth + x1) * 3 + c];
        const botLeft = imageData[(y1 * srcWidth + x0) * 3 + c];
        const botRight = imageData[(y1 * srcWidth + x1) * 3 + c];

        const top = topLeft + (topRight - topLeft) * fx;
        const bot = botLeft + (botRight - botLeft) * fx;
        dst[dstIdx + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }

  return dst;
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

/**
 * Crop a face region from an image with an optional padding margin.
 *
 * @param imageData - Source RGB pixels.
 * @param width     - Source width.
 * @param height    - Source height.
 * @param bbox      - Bounding box `[x1, y1, x2, y2]` in pixel coordinates.
 * @param margin    - Fractional padding to add around the box (default 0.2 = 20 %).
 * @returns The cropped sub-image.
 */
export function cropFace(
  imageData: Uint8Array,
  width: number,
  height: number,
  bbox: number[],
  margin: number = 0.2,
): ProcessedImage {
  const [bx1, by1, bx2, by2] = bbox;
  const bw = bx2 - bx1;
  const bh = by2 - by1;

  // Expand by margin and clamp to image bounds.
  const x1 = Math.max(0, Math.floor(bx1 - bw * margin));
  const y1 = Math.max(0, Math.floor(by1 - bh * margin));
  const x2 = Math.min(width, Math.ceil(bx2 + bw * margin));
  const y2 = Math.min(height, Math.ceil(by2 + bh * margin));

  const cropW = x2 - x1;
  const cropH = y2 - y1;
  const cropped = new Uint8Array(cropW * cropH * 3);

  for (let row = 0; row < cropH; row++) {
    const srcOffset = ((y1 + row) * width + x1) * 3;
    const dstOffset = row * cropW * 3;
    cropped.set(imageData.subarray(srcOffset, srcOffset + cropW * 3), dstOffset);
  }

  return { data: cropped, width: cropW, height: cropH };
}

// ---------------------------------------------------------------------------
// Affine-based face alignment
// ---------------------------------------------------------------------------

/**
 * Solve a 2×3 affine transform that maps `src` points → `dst` points.
 *
 * Uses a least-squares solution for the 6 unknowns
 * `[a, b, tx, c, d, ty]` where:
 * ```
 *   dstX = a*srcX + b*srcY + tx
 *   dstY = c*srcX + d*srcY + ty
 * ```
 *
 * @param src - Source landmark coordinates (Nx2).
 * @param dst - Destination landmark coordinates (Nx2).
 * @returns The 6-element affine parameter array `[a, b, tx, c, d, ty]`.
 */
function estimateAffine(
  src: number[][],
  dst: readonly (readonly [number, number])[] | number[][],
): number[] {
  // Build over-determined system  A * params = B
  // For each point pair: [ srcX, srcY, 1, 0, 0, 0 ] * params = dstX
  //                       [ 0, 0, 0, srcX, srcY, 1 ] * params = dstY
  const n = src.length;
  const rows = n * 2;
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < n; i++) {
    const sx = src[i][0];
    const sy = src[i][1];
    A.push([sx, sy, 1, 0, 0, 0]);
    A.push([0, 0, 0, sx, sy, 1]);
    B.push(dst[i][0]);
    B.push(dst[i][1]);
  }

  // Normal equations: (A^T A) x = A^T B
  const ATA = Array.from({ length: 6 }, () => new Float64Array(6));
  const ATB = new Float64Array(6);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < 6; j++) {
      ATB[j] += A[i][j] * B[i];
      for (let k = 0; k < 6; k++) {
        ATA[j][k] += A[i][j] * A[i][k];
      }
    }
  }

  // Solve with Gaussian elimination (6×7 augmented matrix).
  const aug: number[][] = ATA.map((row, i) => [...row, ATB[i]]);

  for (let col = 0; col < 6; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < 6; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Singular matrix in affine estimation');
    }

    for (let j = col; j <= 6; j++) {
      aug[col][j] /= pivot;
    }

    for (let row = 0; row < 6; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= 6; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map(row => row[6]);
}

/**
 * Apply a 2×3 affine transform to an RGB image, producing a new image of size
 * `dstWidth × dstHeight`.
 *
 * @param imageData - Source RGB pixels.
 * @param srcWidth  - Source image width.
 * @param srcHeight - Source image height.
 * @param params    - Affine parameters `[a, b, tx, c, d, ty]` mapping
 *                    **source → destination**. We invert internally for
 *                    backward mapping.
 * @param dstWidth  - Output width.
 * @param dstHeight - Output height.
 * @returns The warped image.
 */
function warpAffine(
  imageData: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  params: number[],
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  const [a, b, tx, c, d, ty] = params;

  // Invert the affine to map dst → src (backward mapping).
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Non-invertible affine transform');
  }
  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;
  const invTx = -(invA * tx + invB * ty);
  const invTy = -(invC * tx + invD * ty);

  const out = new Uint8Array(dstWidth * dstHeight * 3);

  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const srcX = invA * dx + invB * dy + invTx;
      const srcY = invC * dx + invD * dy + invTy;

      // Bilinear sample from source.
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      if (x0 < 0 || y0 < 0 || x0 >= srcWidth - 1 || y0 >= srcHeight - 1) {
        continue; // leave as 0 (black padding)
      }
      const fx = srcX - x0;
      const fy = srcY - y0;

      const dstIdx = (dy * dstWidth + dx) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const tl = imageData[(y0 * srcWidth + x0) * 3 + ch];
        const tr = imageData[(y0 * srcWidth + (x0 + 1)) * 3 + ch];
        const bl = imageData[((y0 + 1) * srcWidth + x0) * 3 + ch];
        const br = imageData[((y0 + 1) * srcWidth + (x0 + 1)) * 3 + ch];

        const top = tl + (tr - tl) * fx;
        const bot = bl + (br - bl) * fx;
        out[dstIdx + ch] = Math.round(top + (bot - top) * fy);
      }
    }
  }

  return out;
}

/**
 * Align a face image to the standard ArcFace 112×112 template using
 * five-point landmarks detected by SCRFD.
 *
 * @param imageData - Source RGB pixels.
 * @param width     - Source image width.
 * @param height    - Source image height.
 * @param landmarks - Five 2D landmarks `[[x,y], …]` in the order:
 *                    left-eye, right-eye, nose, left-mouth, right-mouth.
 * @returns The aligned 112×112 face image.
 */
export function alignFace(
  imageData: Uint8Array,
  width: number,
  height: number,
  landmarks: number[][],
): ProcessedImage {
  if (landmarks.length !== 5) {
    throw new Error(
      `alignFace: expected 5 landmarks, received ${landmarks.length}`,
    );
  }

  const dstW = 112;
  const dstH = 112;

  // Compute affine: source landmarks → ArcFace reference landmarks.
  const affineParams = estimateAffine(landmarks, ARCFACE_REFERENCE_LANDMARKS);

  const aligned = warpAffine(imageData, width, height, affineParams, dstW, dstH);

  return { data: aligned, width: dstW, height: dstH };
}

/**
 * Converts a VisionCamera Frame (BGRA 32-bit format) to a Uint8Array (RGB)
 * suitable for our ML pipeline.
 * 
 * @param frameWidth The width of the frame
 * @param frameHeight The height of the frame
 * @param bytesPerRow The number of bytes per row in the frame buffer
 * @param frameBuffer The ArrayBuffer obtained from frame.getPixelBuffer()
 * @returns Object with RGB image data, width, and height
 */
export function convertFrameToRGB(
  frameWidth: number,
  frameHeight: number,
  bytesPerRow: number,
  frameBuffer: ArrayBuffer
): { data: Uint8Array; width: number; height: number } {
  // VisionCamera 'rgb' output is actually BGRA (32-bit) on iOS and often Android
  const bgra = new Uint8Array(frameBuffer);
  const rgb = new Uint8Array(frameWidth * frameHeight * 3);
  
  let i = 0;
  for (let y = 0; y < frameHeight; y++) {
    const rowOffset = y * bytesPerRow;
    for (let x = 0; x < frameWidth; x++) {
      const bgraIdx = rowOffset + x * 4;
      // Convert BGRA to RGB
      rgb[i] = bgra[bgraIdx + 2];     // R
      rgb[i + 1] = bgra[bgraIdx + 1]; // G
      rgb[i + 2] = bgra[bgraIdx];     // B
      i += 3;
    }
  }
  
  return { data: rgb, width: frameWidth, height: frameHeight };
}
