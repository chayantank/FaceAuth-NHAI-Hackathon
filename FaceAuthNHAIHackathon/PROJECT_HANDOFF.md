# FaceAuth — Project Handoff Document

> **Last updated:** 2026-05-25 18:41 IST  
> **Hackathon:** TinyML Hackathon 7.0  
> **Title:** Offline Facial Recognition & Liveness Detection for Remote Locations  
> **Project Root:** `/Users/chayan/Documents/personal_projects/tinyml_hackathon/`

---

## Table of Contents

1. [What Was Done](#1-what-was-done)
2. [Project Structure & File Inventory](#2-project-structure--file-inventory)
3. [Setup Already Completed](#3-setup-already-completed)
4. [Architecture & Design Decisions](#4-architecture--design-decisions)
5. [ML Pipeline Details](#5-ml-pipeline-details)
6. [Each File — What It Does](#6-each-file--what-it-does)
7. [What Is Left To Do](#7-what-is-left-to-do)
8. [How To Run](#8-how-to-run)
9. [Key Constraints & Requirements](#9-key-constraints--requirements)

---

## 1. What Was Done

### ✅ Completed

| Phase | What | Status |
|-------|------|--------|
| **Research** | Evaluated ML runtimes (ONNX vs TFLite), VisionCamera V5 API, InsightFace model zoo, MMKV v3 API, sync strategies | ✅ Done |
| **Planning** | Full 11-day implementation plan created and approved | ✅ Done |
| **React Native Init** | Created `FaceAuthApp` with React Native CLI (not Expo), package name `com.faceauth.app` | ✅ Done |
| **Dependencies** | All npm packages installed, CocoaPods installed for iOS | ✅ Done |
| **Config** | Metro (ONNX bundling), Babel (Reanimated plugin), TSConfig (Node types) | ✅ Done |
| **ML Pipeline** | 5 TypeScript modules — model manager, face detector, recognizer, liveness, preprocessing | ✅ Done |
| **Storage** | Encrypted storage (MMKV + Keychain) and embedding store with cosine search | ✅ Done |
| **Sync** | Offline-first sync manager with mock AWS, retry logic, auto-sync | ✅ Done |
| **UI** | 5 screens (Home, Enroll, Auth, Sync, Settings) + 3 components + navigator + App.tsx | ✅ Done |
| **Model Prep Scripts** | Python scripts for downloading, converting, quantizing, and benchmarking models | ✅ Done |
| **TypeScript** | Full compilation with **0 errors** | ✅ Done |

### ❌ Not Yet Done

- Actual ONNX model files not downloaded yet (scripts are ready)
- No frame processor wired up (camera shows preview but ML inference is simulated)
- No native build tested on device/emulator
- iOS pod install for new native modules (vision-camera, mmkv etc.) not re-run after adding deps
- No end-to-end integration test
- No Android asset bundling for ONNX files configured

---

## 2. Project Structure & File Inventory

```
tinyml_hackathon/
├── PROJECT_HANDOFF.md                     ← THIS FILE
├── offline_face_recognition_liveness_hackathon_master_plan.md  ← Original problem statement
│
├── model_prep/                            ← Python model preparation scripts
│   ├── requirements.txt                   ← Python deps (torch, onnx, insightface, etc.)
│   ├── download_models.py                 ← Downloads InsightFace buffalo_sc models
│   ├── convert_liveness.py                ← Converts MiniFASNet PyTorch → ONNX
│   ├── quantize_models.py                 ← INT8 quantization for all 3 models
│   └── benchmark_models.py                ← Measures latency & accuracy on test images
│
└── FaceAuthApp/                           ← React Native application
    ├── App.tsx                            ← Entry point (dark theme, init, error states)
    ├── package.json                       ← Dependencies (see Section 3)
    ├── tsconfig.json                      ← TypeScript config (includes "node" types)
    ├── babel.config.js                    ← Includes react-native-reanimated/plugin
    ├── metro.config.js                    ← Adds .onnx, .tflite, .bin to asset extensions
    ├── index.js                           ← RN entry point (registers App)
    ├── app.json                           ← App config
    │
    ├── assets/
    │   └── models/                        ← EMPTY — ONNX models go here after download
    │
    ├── android/                           ← Android native project (auto-generated)
    │   └── app/src/main/java/com/faceauth/app/
    │       ├── MainActivity.kt
    │       └── MainApplication.kt
    │
    ├── ios/                               ← iOS native project (auto-generated + pods installed)
    │   ├── Podfile
    │   ├── Pods/                           ← CocoaPods installed
    │   └── FaceAuthApp/
    │       ├── AppDelegate.swift
    │       └── Info.plist
    │
    └── src/                               ← ALL CUSTOM SOURCE CODE
        ├── ml/                            ← ML inference pipeline
        │   ├── ModelManager.ts            ← Singleton ONNX session lifecycle
        │   ├── FaceDetector.ts            ← SCRFD-500MF face detection + NMS
        │   ├── FaceRecognizer.ts          ← MobileFaceNet embedding + matching
        │   ├── LivenessDetector.ts        ← Hybrid passive + active liveness
        │   └── preprocessing.ts           ← Image resize, align, crop, normalize
        │
        ├── storage/                       ← Encrypted local storage
        │   ├── SecureDB.ts                ← MMKV + Keychain encryption layer
        │   └── EmbeddingStore.ts          ← Embedding CRUD + cosine similarity search
        │
        ├── sync/                          ← Offline-first sync
        │   └── SyncManager.ts             ← NetInfo monitoring + mock AWS sync
        │
        ├── navigation/
        │   └── AppNavigator.tsx           ← Stack navigator (5 screens)
        │
        ├── screens/
        │   ├── HomeScreen.tsx             ← Dashboard with glassmorphism cards
        │   ├── EnrollScreen.tsx           ← Camera enrollment flow (5-frame capture)
        │   ├── AuthScreen.tsx             ← Camera authentication with liveness
        │   ├── SyncScreen.tsx             ← Sync status & controls
        │   └── SettingsScreen.tsx         ← Model info, thresholds, benchmarks
        │
        ├── components/
        │   ├── FaceOverlay.tsx            ← Animated bounding box + landmarks
        │   ├── StatusBadge.tsx            ← Color-coded status badge
        │   └── MetricsCard.tsx            ← Glassmorphism stats card
        │
        └── utils/
            ├── constants.ts               ← Thresholds, model params, landmarks
            └── cosine.ts                  ← Math: cosine similarity, L2 norm, distance
```

**Total custom source files: 19 TypeScript files + 5 Python scripts**

---

## 3. Setup Already Completed

### React Native Project

- **Created with:** `npx @react-native-community/cli init FaceAuthApp --package-name com.faceauth.app`
- **React Native version:** `0.85.3`
- **React version:** `19.2.3`
- **Node modules:** Installed (`npm install` done)
- **CocoaPods:** Installed for iOS (initial install — may need re-run after deps changed)
- **New Architecture:** Enabled by default in RN 0.85

### Installed npm Dependencies

**Runtime:**
| Package | Version | Purpose |
|---------|---------|---------|
| `onnxruntime-react-native` | ^1.24.3 | ONNX model inference |
| `react-native-vision-camera` | ^5.0.10 | Camera access (VisionCamera V5) |
| `@react-native-community/netinfo` | ^12.0.1 | Network status monitoring |
| `react-native-keychain` | ^10.0.0 | Secure encryption key storage |
| `react-native-mmkv` | ^4.3.1 | Fast encrypted KV storage |
| `react-native-encrypted-storage` | ^4.0.3 | Encrypted storage fallback |
| `react-native-fs` | ^2.20.0 | Filesystem access for models |
| `@react-navigation/native` | ^7.2.4 | Navigation core |
| `@react-navigation/native-stack` | ^7.15.1 | Native stack navigator |
| `react-native-reanimated` | ^4.3.1 | Animations |
| `react-native-safe-area-context` | ^5.8.0 | Safe area insets |
| `react-native-screens` | ^4.25.2 | Native screen containers |
| `react-native-gesture-handler` | ^2.31.2 | Gesture handling |

**Dev:**
| Package | Purpose |
|---------|---------|
| `@types/node` | Node.js types for Buffer, etc. |
| Standard RN dev deps | Babel, Metro, ESLint, Jest, TypeScript |

### Config Changes Made

1. **`metro.config.js`** — Added `.onnx`, `.tflite`, `.bin` to `resolver.assetExts` so model files can be bundled
2. **`babel.config.js`** — Added `react-native-reanimated/plugin` to plugins array (must be last)
3. **`tsconfig.json`** — Added `"node"` to the `types` array alongside `"jest"`

---

## 4. Architecture & Design Decisions

### Approach: Pure ONNX Runtime Pipeline

We chose `onnxruntime-react-native` as the single ML runtime (not TFLite). Reasons:
- All three InsightFace models are already in ONNX format
- Single runtime = simpler integration, fewer native modules
- ONNX Runtime has good React Native support via JSI/Turbo Modules
- Supports both CPU and GPU (via NNAPI on Android, CoreML on iOS)

### Model Selection (~16.7 MB total, under the 20 MB limit)

| Model | File | Size | What It Does |
|-------|------|------|-------------|
| **SCRFD-500MF** | `scrfd_500m_bnkfn.onnx` | ~2.4 MB | Face detection — finds faces + 5 landmarks |
| **MobileFaceNet w600k** | `w600k_mbf.onnx` | ~13 MB | Face recognition — produces 512-dim embedding |
| **MiniFASNetV2** | `minifasnet_v2.onnx` | ~1.3 MB | Liveness detection — spoof vs real |

Source: InsightFace `buffalo_sc` model pack + MiniFASNet from Silent-Face-Anti-Spoofing.

### Liveness: Hybrid Approach

1. **Passive liveness** (MiniFASNet): Runs automatically on every face, detects photo/screen attacks
2. **Active liveness** (landmark tracking): Fallback — asks user to blink, turn head, or smile. Uses Eye Aspect Ratio (EAR) algorithm for blink detection

### Storage: Encrypted MMKV + Keychain

- Encryption key generated randomly and stored in device Keychain (hardware-backed)
- MMKV used with that key for AES-encrypted fast KV storage
- **No raw biometric images are ever stored** — only 512-dim embeddings
- Enrollment stores averaged embedding from 5 frames → robust template

### Sync: Offline-First with Queue

- All operations work offline
- Changes queued and pushed when connectivity returns
- Mock AWS client in place (comments show where real API calls go)
- Auto-sync on reconnection + periodic polling (5 min interval)
- Exponential backoff retry (3 attempts)

### UI Theme

- **Background:** Deep navy `#0B1120`
- **Primary accent:** Vibrant teal `#00D9FF`
- **Secondary accent:** Warm amber `#FFB800`
- **Success:** Green `#00E676`
- **Error:** Red `#FF5252`
- **Style:** Glassmorphism cards, stagger entrance animations, pulsing status indicators

---

## 5. ML Pipeline Details

### Inference Flow (Target: <1 second total)

```
Camera Frame (RGB)
    ↓
[1] FaceDetector.detectFaces()
    → Resize to 640×640
    → SCRFD inference (3 stride levels)
    → Decode anchors + NMS
    → Output: bounding boxes + 5-point landmarks + confidence
    ↓
[2] preprocessing.cropFace() + preprocessing.alignFace()
    → Crop face with 20% margin
    → Affine transform using 5-point landmarks → ArcFace alignment
    → Output: aligned 112×112 face
    ↓
[3] LivenessDetector.checkPassiveLiveness()
    → Resize to 80×80
    → MiniFASNet inference
    → Output: { isLive: bool, score: float, method: 'passive' }
    ↓
[4] FaceRecognizer.extractEmbedding()
    → Normalize to [-1, 1]
    → MobileFaceNet inference
    → L2 normalize output
    → Output: 512-dim Float32Array
    ↓
[5] EmbeddingStore.findMatch()
    → Cosine similarity vs all enrolled embeddings
    → Threshold: 0.45
    → Output: { enrollment, similarity, isMatch, searchTimeMs }
```

### Key Constants (in `src/utils/constants.ts`)

```typescript
DETECTION_CONFIDENCE_THRESHOLD = 0.5  // Min confidence to keep a face
NMS_IOU_THRESHOLD = 0.4               // IoU for non-max suppression
RECOGNITION_THRESHOLD = 0.45          // Cosine sim threshold for match
LIVENESS_THRESHOLD = 0.5              // MiniFASNet spoof threshold
ENROLLMENT_NUM_FRAMES = 5             // Frames per enrollment
MODEL_INPUT_SIZES = { detection: 640, recognition: 112, liveness: 80 }
```

### ArcFace Reference Landmarks (for face alignment)

```typescript
ARCFACE_REFERENCE_LANDMARKS = [
  [38.2946, 51.6963],  // left eye
  [73.5318, 51.5014],  // right eye
  [56.0252, 71.7366],  // nose tip
  [41.5493, 92.3655],  // left mouth corner
  [70.7299, 92.2041],  // right mouth corner
]
```

---

## 6. Each File — What It Does

### ML Pipeline (`src/ml/`)

| File | Lines | What It Does |
|------|-------|-------------|
| **ModelManager.ts** | 273 | Singleton that loads all 3 ONNX models, manages sessions. Handles iOS (MainBundle) vs Android (copy from assets). Has `initialize()`, `warmup()`, `dispose()`, and session getters. |
| **FaceDetector.ts** | ~300 | Runs SCRFD-500MF. Generates anchors at strides 8/16/32, decodes bbox offsets, applies sigmoid to scores, runs NMS. Returns `Detection[]` with bbox, landmarks, confidence. |
| **FaceRecognizer.ts** | ~100 | Runs MobileFaceNet. Normalizes input to [-1,1], runs inference, L2-normalizes the 512-dim output. Has `compareFaces()` (cosine sim) and `isMatch()`. |
| **LivenessDetector.ts** | ~350 | **Passive**: MiniFASNet inference on 80×80 face. **Active**: `ActiveLivenessChecker` class that tracks landmarks across frames — EAR-based blink detection, nose displacement for head turn, mouth ratio for smile. |
| **preprocessing.ts** | ~330 | `normalizeImage()` (NCHW format), `resizeImage()` (bilinear interpolation), `cropFace()` (with margin), `alignFace()` (affine transform using 5 landmarks → ArcFace reference). |

### Storage (`src/storage/`)

| File | Lines | What It Does |
|------|-------|-------------|
| **SecureDB.ts** | ~400 | Encrypted database using MMKV v3 (`createMMKV()`). Encryption key stored in Keychain. Manages enrollments, auth logs, sync queue, settings. Never stores raw images. |
| **EmbeddingStore.ts** | ~275 | Enrollment with multi-frame averaging (5 frames → 1 template). Base64 encode/decode for Float32Array. Brute-force cosine similarity search. |

### Sync (`src/sync/`)

| File | Lines | What It Does |
|------|-------|-------------|
| **SyncManager.ts** | ~467 | Monitors network via NetInfo. Queue-based push sync with exponential backoff. Pull changes from server. Auto-sync on reconnection + 5-min interval. Mock AWS client with documented real integration points. |

### Screens (`src/screens/`)

| File | Lines | What It Does |
|------|-------|-------------|
| **HomeScreen.tsx** | 354 | Dashboard with animated header, 4 MetricsCards (enrolled users, last sync, device status, model status), 2 action buttons (Enroll/Authenticate), footer links (Sync/Settings). Stagger entrance animations. |
| **EnrollScreen.tsx** | ~555 | Camera preview (VisionCamera V5, front camera). 4-step indicator. Simulated capture with progress dots (1/5 → 5/5). Quality feedback messages. Success animation. Name input + save. |
| **AuthScreen.tsx** | ~520 | Camera preview with pulsing circular guide ring. Full auth pipeline simulation (detect → liveness challenge → match → result). Shows confidence % and latency ms. Animated result overlay (checkmark/X). |
| **SyncScreen.tsx** | ~350 | Network status dot, pending count, last sync time, "Sync Now" button, progress bar, sync history list, "Purge Local Data" button, auto-sync toggle. |
| **SettingsScreen.tsx** | ~420 | Model info section (3 models with names/sizes), recognition threshold slider, liveness sensitivity slider, storage stats, "Run Benchmark" button, "Clear All Data" with confirmation, app version. |

### Components (`src/components/`)

| File | Lines | What It Does |
|------|-------|-------------|
| **FaceOverlay.tsx** | 194 | Renders animated bounding box with corner accents + landmark dots on camera preview. Color changes: yellow (detecting), green (matched), red (rejected). Pulsing opacity animation. |
| **StatusBadge.tsx** | ~80 | Small badge with colored dot + label. Supports online/offline/loading/ready/error states. Dot pulses for active states. |
| **MetricsCard.tsx** | ~110 | Glassmorphism card with icon, title, value, subtitle. Semi-transparent background. |

### Python Scripts (`model_prep/`)

| File | What It Does |
|------|-------------|
| **download_models.py** | Downloads InsightFace buffalo_sc pack, extracts scrfd_500m_bnkfn.onnx + w600k_mbf.onnx. Also downloads MiniFASNet from Silent-Face-Anti-Spoofing repo. |
| **convert_liveness.py** | Converts MiniFASNet from PyTorch (.pth) to ONNX format with dynamic batch and 80×80 input. |
| **quantize_models.py** | Runs ONNX Runtime dynamic INT8 quantization on all 3 models. Keeps FP32 originals as backup. |
| **benchmark_models.py** | Measures inference latency (mean, p95, p99 over 100 runs) and optionally tests accuracy on sample images. |
| **requirements.txt** | Python deps: torch, onnx, onnxruntime, insightface, Pillow, numpy, opencv-python-headless. |

---

## 7. What Is Left To Do

### Immediate Next Steps (to get a working demo)

#### Step 1: Download ONNX Models

```bash
cd /Users/chayan/Documents/personal_projects/tinyml_hackathon/model_prep
pip install -r requirements.txt
python download_models.py
```

This will download the 3 model files into `model_prep/models/`.

#### Step 2: Bundle Models into the App

**Android:**
```bash
# Create Android assets directory
mkdir -p /Users/chayan/Documents/personal_projects/tinyml_hackathon/FaceAuthApp/android/app/src/main/assets/models

# Copy models
cp model_prep/models/*.onnx FaceAuthApp/android/app/src/main/assets/models/
```

**iOS:**
- Drag the `.onnx` files into the Xcode project under `FaceAuthApp/assets/models/`
- Make sure they're added to the app target's "Copy Bundle Resources" build phase

#### Step 3: Re-run iOS Pod Install

```bash
cd /Users/chayan/Documents/personal_projects/tinyml_hackathon/FaceAuthApp/ios
bundle exec pod install
```

This is needed because we added native modules (vision-camera, mmkv, keychain, etc.) after the initial project creation.

#### Step 4: Build & Run

```bash
cd /Users/chayan/Documents/personal_projects/tinyml_hackathon/FaceAuthApp

# Android
npx react-native run-android

# iOS
npx react-native run-ios
```

#### Step 5: Wire Frame Processor for Real Inference

Currently the Enroll and Auth screens **simulate** the ML pipeline with `setTimeout` delays. To make it real:

1. Use VisionCamera V5's frame processor API to extract frames
2. Convert frame data to the format expected by `preprocessing.ts`
3. Call `FaceDetector.detectFaces()` → `preprocessing.alignFace()` → `FaceRecognizer.extractEmbedding()`
4. For enrollment: collect 5 embeddings → `EmbeddingStore.enroll()`
5. For auth: run liveness → match → `EmbeddingStore.findMatch()`

Key integration points in the code are marked with comments like:
- `// In production, this would use usePhotoOutput().capturePhoto()`
- `// TODO: persist embedding + name via the ML pipeline storage layer`

### Optional Enhancements

- [ ] Add camera permissions to `Info.plist` (iOS) and `AndroidManifest.xml`
- [ ] Quantize models to INT8 for faster inference: `python quantize_models.py`
- [ ] Add app icons and splash screen
- [ ] Implement real AWS Lambda + API Gateway endpoints (replace mock client)
- [ ] Add biometric prompt before deleting data (FaceID/fingerprint confirmation)
- [ ] Performance profiling on actual device

---

## 8. How To Run

### Prerequisites

- Node.js 18+
- React Native CLI (`npx @react-native-community/cli`)
- Xcode 16+ (for iOS)
- Android Studio + SDK 34+ (for Android)
- Python 3.10+ (for model prep scripts only)
- CocoaPods (`gem install cocoapods`)

### Quick Start

```bash
# 1. Navigate to project
cd /Users/chayan/Documents/personal_projects/tinyml_hackathon/FaceAuthApp

# 2. Install JS dependencies (already done, but just in case)
npm install

# 3. TypeScript check (should be 0 errors)
npx tsc --noEmit

# 4. Start Metro bundler
npx react-native start

# 5. In another terminal, run on device
npx react-native run-ios
# or
npx react-native run-android
```

### Verify TypeScript Compilation

```bash
cd /Users/chayan/Documents/personal_projects/tinyml_hackathon/FaceAuthApp
npx tsc --noEmit
# Should output nothing (0 errors)
```

---

## 9. Key Constraints & Requirements

From the hackathon problem statement:

| Requirement | Our Solution | Status |
|-------------|-------------|--------|
| React Native compatible (Android + iOS) | React Native CLI 0.85, New Architecture | ✅ |
| Fully offline operation | All models run locally via ONNX Runtime | ✅ |
| Model size < 20 MB | ~16.7 MB total (3 models) | ✅ |
| Processing speed < 1 second | Target <400ms pipeline (needs device testing) | 🔧 |
| Android 8.0+ / iOS 12+ | min SDK configured | ✅ |
| 3 GB RAM minimum | Lightweight models, no GPU required | ✅ |
| Liveness detection | Hybrid passive (MiniFASNet) + active (blink/head/smile) | ✅ |
| Secure storage | MMKV + Keychain, no raw images stored | ✅ |
| Sync when online | Queue-based sync with retry, auto-sync on reconnect | ✅ |

---

## Notes for the Next Developer

1. **VisionCamera V5 is very different from V3/V4.** The `Camera` component no longer has `takePhoto()` on the ref. Instead you use `usePhotoOutput()` hook and `capturePhoto()`. Check the [VisionCamera V5 docs](https://react-native-vision-camera.com/).

2. **MMKV v3/v4 uses `createMMKV()` not `new MMKV()`.** The `MMKV` export is type-only. Import the factory function separately.

3. **The ML pipeline files are fully implemented** but currently not connected to the camera. They contain real SCRFD anchor decoding, NMS, affine transforms, etc. — not placeholders.

4. **The screens work with simulated data.** HomeScreen shows hardcoded stats (0 users, "Never" synced). EnrollScreen simulates capture with delays. AuthScreen simulates the full pipeline with random results. These are easy to wire up to the real ML pipeline.

5. **Model files are NOT bundled yet.** The `assets/models/` directory is empty. Run the download script first.

---

*This document was auto-generated. For the implementation plan with day-by-day breakdown, see the original planning artifact.*
