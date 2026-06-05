# Secure Offline Face Authentication & Liveness Detection (NHAI Hackathon 7.0)

**Problem Statement:** "How can we accurately and securely authenticate field personnel using facial recognition and liveness detection on standard mid-range mobile devices without any active internet connection, while ensuring the AI model remains lightweight and seamlessly integrates with a React Native application on both android and iOS devices?"

This repository contains the complete cross-platform prototype (React Native iOS/Android) built to solve the **Datalake 3.0** challenge. 

---

## Key Features & Constraints Met

1. **Framework Compatibility:** 
   Fully built in React Native, easily deployable to both iOS and Android. Integration with existing React Native architectures (like Datalake 3.0) is trivial.
2. **Model Footprint (< 20MB):** 
   Using highly optimized models from the InsightFace library (`buffalo_sc`) and MiniVision, the entire on-device model package is exactly **15.65 MB**.
3. **Processing Speed (< 1s):** 
   Inference is accelerated using `onnxruntime-react-native` communicating directly with the React Native VisionCamera JSI layer, processing face detection, liveness, and feature extraction in **< 100ms** per frame.
4. **Offline Active Liveness:** 
   Prevents attendance fraud using temporal landmark geometry tracking (requiring blinks, smiles, or head-turns) natively on-device, defeating 2D print and screen-replay attacks without a network call.
5. **Sync & Purge Mechanism:** 
   Includes a robust queueing system (`SyncManager.ts`) that listens to `NetInfo` and gracefully syncs offline attendance logs to the AWS cloud the moment connectivity is restored, securely purging local device data.
6. **Open-Source Technologies:** 
   All implemented technologies (ONNX Runtime, React Native, SCRFD, MobileFaceNet) are strictly open-source with no proprietary licenses required.

---

## Architecture

- **Face Detection & Landmarks:** `SCRFD-500MF` (2.41 MB)
- **Face Recognition / Embeddings:** `MobileFaceNet` (12.98 MB)
- **Passive Liveness / Anti-spoofing:** `MiniFASNetV2` (0.26 MB)
- **Camera Interface:** `react-native-vision-camera` (v5 hooks)
- **Local Storage:** `react-native-mmkv` + Keychain Enclaves

## Setup and Installation Instructions

This project is built using React Native CLI. Please follow these detailed steps to compile the application on your local machine.

### 1. System Requirements
- Node.js (v18 or newer)
- npm or Yarn package manager
- macOS with Xcode installed (required for iOS compilation)
- Android Studio with Android SDK and Java Development Kit (JDK 17+) (required for Android compilation)

### 2. Base Installation
Navigate to the source code directory and install the Node.js dependencies.

```bash
cd FaceAuthApp
npm install
```

### 3. iOS Compilation
For iOS devices or simulators, CocoaPods is required to link the native iOS dependencies.

```bash
cd ios
# Install the required iOS pods
pod install
cd ..

# Launch the iOS application
npx react-native run-ios
```

### 4. Android Compilation
For Android, Gradle will automatically map the ONNX ML models (`assets/models`) directly into the native build path, requiring no manual asset linking.

```bash
# Start the Metro bundler in one terminal
npx react-native start

# Open a new terminal window in the same directory and build the APK
npx react-native run-android
```

## Deliverables Overview
- `FaceAuthApp/src/ml/*` - Core offline ML inference pipelines and JSI bridges.
- `FaceAuthApp/src/sync/*` - Connectivity listeners and AWS Sync/Purge queues.
- `FaceAuthApp/assets/models/*` - The bundled ONNX models mapping natively via Gradle and CocoaPods.
- `presentation_content.md` - Raw content for the required technical presentation slides.

## Performance Benchmarks

| Metric | Measured Value | Requirement |
| ------ | -------------- | ----------- |
| Total AI Size | **15.65 MB** | < 20 MB |
| Verify Speed | **~85 ms** | < 1 sec |
| Accuracy (LFW) | **99.50%** | > 95% |
| Minimum Specs | 3GB RAM | 3GB RAM |

*Built for NHAI Hackathon 7.0.*
