#!/usr/bin/env python3
"""
Convert MiniFASNet PyTorch checkpoints (.pth) to ONNX format.

This script converts the Silent-Face-Anti-Spoofing pretrained models
to ONNX format suitable for mobile deployment via onnxruntime-react-native.

Prerequisites:
  pip install torch onnx onnxruntime
  python download_models.py  # to clone the repo first

Usage:
  python convert_liveness.py
"""

import os
import sys
import shutil
from pathlib import Path

import torch
import torch.nn as nn
import onnx
import onnxruntime as ort
import numpy as np

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "FaceAuthApp" / "assets" / "models"
SILENT_FACE_DIR = SCRIPT_DIR / "_temp_downloads" / "Silent-Face-Anti-Spoofing"

# Add the Silent-Face repo to path so we can import its modules
sys.path.insert(0, str(SILENT_FACE_DIR / "src"))


def find_model_checkpoints():
    """Find all .pth model files in the Silent-Face repo."""
    model_dir = SILENT_FACE_DIR / "resources" / "anti_spoof_models"
    if not model_dir.exists():
        print(f"ERROR: Model directory not found: {model_dir}")
        print("Run download_models.py first.")
        sys.exit(1)

    checkpoints = []
    for pth_file in model_dir.rglob("*.pth"):
        size_mb = pth_file.stat().st_size / 1024 / 1024
        checkpoints.append((pth_file, size_mb))
        print(f"  Found: {pth_file.relative_to(model_dir)} ({size_mb:.2f} MB)")

    return checkpoints


def convert_minifasnet_to_onnx(pth_path: Path, output_name: str, input_size=(80, 80)):
    """
    Convert a MiniFASNet checkpoint to ONNX.

    Args:
        pth_path: Path to the .pth checkpoint
        output_name: Output filename (without extension)
        input_size: Model input size (height, width)
    """
    print(f"\nConverting: {pth_path.name}")
    print(f"  Input size: {input_size}")

    try:
        # Try to import the model architecture from the repo
        from model_lib.MiniFASNet import (
            MiniFASNetV2,
            MiniFASNetV1SE,
            MiniFASNetV2SE,
        )
    except ImportError:
        print("  WARNING: Could not import MiniFASNet architecture from repo.")
        print("  Attempting to load with generic approach...")
        return convert_generic_checkpoint(pth_path, output_name, input_size)

    # Determine model variant from filename
    model_name = pth_path.stem.lower()

    # Create model instance based on variant
    # MiniFASNet models typically have these configs
    conv6_kernel = (5, 5) if input_size == (80, 80) else (7, 7)

    model_map = {
        "v2": lambda: MiniFASNetV2(conv6_kernel=conv6_kernel),
        "v1se": lambda: MiniFASNetV1SE(conv6_kernel=conv6_kernel),
        "v2se": lambda: MiniFASNetV2SE(conv6_kernel=conv6_kernel),
    }

    model = None
    for key, factory in model_map.items():
        if key in model_name:
            print(f"  Detected variant: {key}")
            model = factory()
            break

    if model is None:
        print(f"  Could not determine variant from filename. Trying MiniFASNetV2...")
        model = MiniFASNetV2(conv6_kernel=conv6_kernel)

    # Load checkpoint
    state_dict = torch.load(pth_path, map_location="cpu", weights_only=False)
    if isinstance(state_dict, dict) and "state_dict" in state_dict:
        state_dict = state_dict["state_dict"]
        
    # Remove 'module.' prefix from DataParallel saves
    new_state_dict = {}
    for k, v in state_dict.items():
        name = k[7:] if k.startswith('module.') else k
        new_state_dict[name] = v
        
    model.load_state_dict(new_state_dict)
    model.eval()

    # Create dummy input
    dummy_input = torch.randn(1, 3, input_size[0], input_size[1])

    # Export to ONNX
    output_path = OUTPUT_DIR / f"{output_name}.onnx"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        export_params=True,
        opset_version=11,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
    )

    # Verify the ONNX model
    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)

    # Test with ONNX Runtime
    session = ort.InferenceSession(str(output_path))
    test_input = np.random.randn(1, 3, input_size[0], input_size[1]).astype(np.float32)
    result = session.run(None, {"input": test_input})

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"  ✅ Exported: {output_path.name} ({size_mb:.2f} MB)")
    print(f"  Output shape: {result[0].shape}")

    return output_path


def convert_generic_checkpoint(pth_path: Path, output_name: str, input_size=(80, 80)):
    """Fallback: try to load and convert a checkpoint generically."""
    print("  Attempting generic checkpoint conversion...")

    try:
        checkpoint = torch.load(pth_path, map_location="cpu", weights_only=False)
        if isinstance(checkpoint, nn.Module):
            model = checkpoint
            model.eval()
        else:
            print(f"  ERROR: Checkpoint is type {type(checkpoint)}, cannot auto-convert.")
            print(f"  Manual conversion required.")
            return None
    except Exception as e:
        print(f"  ERROR: Failed to load checkpoint: {e}")
        return None

    dummy_input = torch.randn(1, 3, input_size[0], input_size[1])
    output_path = OUTPUT_DIR / f"{output_name}.onnx"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model, dummy_input, str(output_path),
        export_params=True, opset_version=11,
        input_names=["input"], output_names=["output"],
    )

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"  ✅ Exported: {output_path.name} ({size_mb:.2f} MB)")
    return output_path


def main():
    print("MiniFASNet → ONNX Converter")
    print("=" * 60)

    # Find checkpoints
    print("\nSearching for model checkpoints...")
    checkpoints = find_model_checkpoints()

    if not checkpoints:
        print("No checkpoints found. Run download_models.py first.")
        sys.exit(1)

    # Convert each checkpoint
    converted = []
    for pth_path, size_mb in checkpoints:
        output_name = f"liveness_{pth_path.stem}"
        result = convert_minifasnet_to_onnx(pth_path, output_name)
        if result:
            converted.append(result)

    # Summary
    print("\n" + "=" * 60)
    print("CONVERSION SUMMARY")
    print("=" * 60)
    for path in converted:
        size_mb = path.stat().st_size / 1024 / 1024
        print(f"  ✅ {path.name:<40} {size_mb:>8.2f} MB")

    if not converted:
        print("  ⚠️ No models were converted successfully.")
        print("  You may need to manually adjust the model architecture.")


if __name__ == "__main__":
    main()
