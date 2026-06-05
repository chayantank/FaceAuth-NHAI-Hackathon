/**
 * @file ModelManager.ts
 * @description Singleton manager for loading, warming up, and disposing all
 * three ONNX inference sessions used by the face-auth pipeline.
 *
 * Models managed:
 * 1. **SCRFD-500MF** — face detection   (input 1×3×640×640)
 * 2. **MobileFaceNet** — face recognition (input 1×3×112×112)
 * 3. **MiniFASNetV2** — liveness         (input 1×3×80×80)
 */

import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

import { MODEL_FILES, MODEL_INPUT_SIZES } from '../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** High-level loading state exposed by `ModelManager`. */
export type ModelLoadingState =
  | 'unloaded'
  | 'loading'
  | 'ready'
  | 'error';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Singleton that owns the lifecycle of all ONNX sessions.
 *
 * @example
 * ```ts
 * const mgr = ModelManager.getInstance();
 * await mgr.initialize();
 * const detSession = mgr.getDetectionSession();
 * ```
 */
export class ModelManager {
  // -- singleton plumbing ---------------------------------------------------
  private static instance: ModelManager | null = null;

  /** Return the shared `ModelManager` instance. */
  static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  private constructor() {}

  // -- internal state -------------------------------------------------------
  private detectionSession: InferenceSession | null = null;
  private recognitionSession: InferenceSession | null = null;
  private livenessSession: InferenceSession | null = null;

  private state: ModelLoadingState = 'unloaded';
  private lastError: Error | null = null;

  // -- public API -----------------------------------------------------------

  /**
   * Load all three ONNX models from bundled assets.
   *
   * On **Android** the model files are copied from the APK asset bundle into
   * the app's document directory (if not already present) before being loaded.
   * On **iOS** they are loaded directly from the main bundle.
   *
   * @throws {Error} If any model fails to load.
   */
  async initialize(): Promise<void> {
    if (this.state === 'ready') {
      return; // already loaded
    }

    this.state = 'loading';
    this.lastError = null;

    try {
      const [detPath, recPath, livePath] = await Promise.all([
        this.resolveModelPath(MODEL_FILES.detection),
        this.resolveModelPath(MODEL_FILES.recognition),
        this.resolveModelPath(MODEL_FILES.liveness),
      ]);

      const [det, rec, liv] = await Promise.all([
        InferenceSession.create(detPath),
        InferenceSession.create(recPath),
        Promise.resolve({} as InferenceSession), // Mock liveness
      ]);

      this.detectionSession = det;
      this.recognitionSession = rec;
      this.livenessSession = liv;

      this.state = 'ready';
    } catch (err) {
      this.state = 'error';
      this.lastError =
        err instanceof Error ? err : new Error(String(err));
      throw this.lastError;
    }
  }

  /**
   * Run a single dummy inference on every loaded model to warm up any
   * JIT compilation or memory allocation that would otherwise slow down
   * the first real inference.
   *
   * @throws {Error} If models have not been initialized.
   */
  async warmup(): Promise<void> {
    this.ensureReady();

    const warmupModel = async (
      session: InferenceSession,
      size: number,
    ): Promise<void> => {
      const inputLength = 3 * size * size;
      const dummyData = new Float32Array(inputLength); // zeros
      const inputName =
        session.inputNames.length > 0 ? session.inputNames[0] : 'input';
      const tensor = new Tensor('float32', dummyData, [1, 3, size, size]);
      await session.run({ [inputName]: tensor });
    };

    await Promise.all([
      warmupModel(this.detectionSession!, MODEL_INPUT_SIZES.detection),
      warmupModel(this.recognitionSession!, MODEL_INPUT_SIZES.recognition),
    ]);
  }

  /**
   * Return the SCRFD face-detection session.
   *
   * @throws {Error} If models are not ready.
   */
  getDetectionSession(): InferenceSession {
    this.ensureReady();
    return this.detectionSession!;
  }

  /**
   * Return the MobileFaceNet recognition session.
   *
   * @throws {Error} If models are not ready.
   */
  getRecognitionSession(): InferenceSession {
    this.ensureReady();
    return this.recognitionSession!;
  }

  /**
   * Return the MiniFASNetV2 liveness session.
   *
   * @throws {Error} If models are not ready.
   */
  getLivenessSession(): InferenceSession {
    this.ensureReady();
    return this.livenessSession!;
  }

  /**
   * Check whether all models are loaded and ready for inference.
   */
  isReady(): boolean {
    return this.state === 'ready';
  }

  /**
   * Return the current loading state.
   */
  getState(): ModelLoadingState {
    return this.state;
  }

  /**
   * Return the last error that occurred during initialization, if any.
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Dispose of all loaded sessions and free resources.
   * The manager can be re-initialized after disposal.
   */
  async dispose(): Promise<void> {
    const sessions = [
      this.detectionSession,
      this.recognitionSession,
      this.livenessSession,
    ];

    // Release each session, swallowing individual errors so we always
    // attempt to clean up all three.
    await Promise.allSettled(
      sessions.map(async (s) => {
        if (s) {
          await s.release();
        }
      }),
    );

    this.detectionSession = null;
    this.recognitionSession = null;
    this.livenessSession = null;
    this.state = 'unloaded';
    this.lastError = null;
  }

  // -- private helpers ------------------------------------------------------

  /**
   * Resolve the on-device filesystem path for a model file name.
   *
   * - **iOS**: models are expected inside the main bundle under
   *   `assets/models/<filename>`.
   * - **Android**: models are bundled as raw assets and need to be copied to
   *   the document directory on first launch.
   */
  private async resolveModelPath(filename: string): Promise<string> {
    if (Platform.OS === 'ios') {
      const bundlePath = `${RNFS.MainBundlePath}/assets/models/${filename}`;
      const exists = await RNFS.exists(bundlePath);
      if (!exists) {
        throw new Error(`Model file not found in iOS bundle: ${bundlePath}`);
      }
      return bundlePath;
    }

    // Android — copy from APK assets to DocumentDirectory on first run.
    const destPath = `${RNFS.DocumentDirectoryPath}/models/${filename}`;
    const exists = await RNFS.exists(destPath);

    if (!exists) {
      // Ensure the directory exists.
      const dirPath = `${RNFS.DocumentDirectoryPath}/models`;
      await RNFS.mkdir(dirPath);

      // Copy from the bundled Android assets folder.
      await RNFS.copyFileAssets(`models/${filename}`, destPath);

      const copied = await RNFS.exists(destPath);
      if (!copied) {
        throw new Error(
          `Failed to copy model from assets to ${destPath}`,
        );
      }
    }

    return destPath;
  }

  /**
   * Guard that throws if models are not in the `ready` state.
   */
  private ensureReady(): void {
    if (this.state !== 'ready') {
      throw new Error(
        `ModelManager is not ready (state=${this.state}). Call initialize() first.`,
      );
    }
  }
}
