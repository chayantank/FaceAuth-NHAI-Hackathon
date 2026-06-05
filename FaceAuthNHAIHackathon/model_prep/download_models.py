#!/usr/bin/env python3
"""
Download and prepare ONNX models for the FaceAuth offline recognition system.

Models:
  1. SCRFD-500MF (face detection + 5-point landmarks) — from InsightFace buffalo_sc
  2. MobileFaceNet w600k_mbf (face recognition) — from InsightFace buffalo_sc
  3. MiniFASNetV2 (passive liveness / anti-spoofing) — from Silent-Face-Anti-Spoofing

Usage:
  pip install insightface onnx onnxruntime
  python download_models.py
"""

import os
import sys
import shutil
import urllib.request
import zipfile
from pathlib import Path

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "FaceAuthApp" / "assets" / "models"
TEMP_DIR = SCRIPT_DIR / "_temp_downloads"

# InsightFace buffalo_sc model pack URL (contains SCRFD-500MF + MobileFaceNet)
# We use the insightface Python library to auto-download
INSIGHTFACE_MODEL_NAME = "buffalo_sc"

# Silent-Face-Anti-Spoofing repo for MiniFASNet
SILENT_FACE_REPO = "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"


def ensure_dir(path: Path):
    """Create directory if it doesn't exist."""
    path.mkdir(parents=True, exist_ok=True)


def download_insightface_models():
    """
    Download SCRFD-500MF and MobileFaceNet from InsightFace model zoo.
    Uses the insightface Python package which auto-downloads models.
    """
    print("\n" + "=" * 60)
    print("Step 1: Downloading InsightFace buffalo_sc models")
    print("=" * 60)

    try:
        import insightface
        from insightface.app import FaceAnalysis
    except ImportError:
        print("ERROR: insightface package not installed.")
        print("Run: pip install insightface onnx onnxruntime")
        sys.exit(1)

    # FaceAnalysis auto-downloads the model pack to ~/.insightface/models/
    print(f"Downloading model pack: {INSIGHTFACE_MODEL_NAME}")
    print("(This downloads to ~/.insightface/models/ automatically)")

    app = FaceAnalysis(
        name=INSIGHTFACE_MODEL_NAME,
        allowed_modules=["detection", "recognition"],
    )
    app.prepare(ctx_id=-1, det_size=(640, 640))  # CPU mode

    # Find the downloaded models
    insightface_dir = Path.home() / ".insightface" / "models" / INSIGHTFACE_MODEL_NAME
    if not insightface_dir.exists():
        print(f"ERROR: Model directory not found at {insightface_dir}")
        sys.exit(1)

    # Copy models to our output directory
    ensure_dir(OUTPUT_DIR)

    for onnx_file in insightface_dir.glob("*.onnx"):
        dest = OUTPUT_DIR / onnx_file.name
        print(f"  Copying: {onnx_file.name} ({onnx_file.stat().st_size / 1024 / 1024:.1f} MB) → {dest}")
        shutil.copy2(onnx_file, dest)

    print("✅ InsightFace models ready!")
    return True


def download_silent_face_models():
    """
    Download MiniFASNet anti-spoofing model from Silent-Face-Anti-Spoofing repo.
    The repo provides PyTorch checkpoints (.pth) which we'll convert to ONNX.
    """
    print("\n" + "=" * 60)
    print("Step 2: Downloading Silent-Face-Anti-Spoofing models")
    print("=" * 60)

    ensure_dir(TEMP_DIR)

    # Clone the repo (shallow) to get the pretrained models
    repo_dir = TEMP_DIR / "Silent-Face-Anti-Spoofing"

    if repo_dir.exists():
        print(f"  Repo already cloned at {repo_dir}")
    else:
        print(f"  Cloning {SILENT_FACE_REPO} (shallow)...")
        os.system(f"git clone --depth 1 {SILENT_FACE_REPO} {repo_dir}")

    # Check for pretrained models
    model_dirs = list(repo_dir.glob("resources/anti_spoof_models/*"))
    if model_dirs:
        print(f"  Found model directories: {[d.name for d in model_dirs]}")
    else:
        print("  WARNING: No pretrained model directories found in resources/anti_spoof_models/")
        print("  You may need to download them manually or convert from checkpoint.")

    print("\n  To convert MiniFASNet to ONNX, run:")
    print("    python convert_liveness.py")
    print("\n✅ Silent-Face-Anti-Spoofing repo ready!")
    return True


def print_summary():
    """Print summary of all downloaded models."""
    print("\n" + "=" * 60)
    print("MODEL SUMMARY")
    print("=" * 60)

    if OUTPUT_DIR.exists():
        total_size = 0
        for f in sorted(OUTPUT_DIR.glob("*.onnx")):
            size_mb = f.stat().st_size / 1024 / 1024
            total_size += size_mb
            print(f"  {f.name:<35} {size_mb:>8.2f} MB")
        print(f"  {'─' * 45}")
        print(f"  {'TOTAL':<35} {total_size:>8.2f} MB")
        print(f"\n  Target: < 20 MB")
        print(f"  Status: {'✅ UNDER BUDGET' if total_size < 20 else '⚠️ OVER BUDGET — consider quantization'}")
    else:
        print("  No models found yet. Run download steps first.")

    print(f"\n  Output directory: {OUTPUT_DIR}")


def main():
    print("FaceAuth Model Downloader")
    print("=" * 60)

    # Step 1: InsightFace models
    download_insightface_models()

    # Step 2: Silent-Face-Anti-Spoofing
    download_silent_face_models()

    # Summary
    print_summary()

    print("\n" + "=" * 60)
    print("NEXT STEPS:")
    print("  1. Convert MiniFASNet to ONNX: python convert_liveness.py")
    print("  2. (Optional) Quantize models: python quantize_models.py")
    print("  3. (Optional) Benchmark: python benchmark_models.py")
    print("=" * 60)


if __name__ == "__main__":
    main()
