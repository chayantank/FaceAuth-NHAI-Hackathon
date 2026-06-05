#!/usr/bin/env python3
"""
quantize_models.py
------------------
Post-Training Dynamic Quantization for all FaceAuth ONNX models.
Converts Float32 weights to UInt8, reducing model size ~3-4x with
minimal accuracy loss on face recognition tasks.

Usage:
    python3 scripts/quantize_models.py

Output:
    assets/models/<model>_int8.onnx  for each model
"""

import os
import sys
from pathlib import Path

try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
except ImportError:
    print("ERROR: onnxruntime not installed. Run: pip install onnxruntime")
    sys.exit(1)

MODELS_DIR = Path(__file__).parent.parent / "assets" / "models"

# Models to quantize: (input_name, output_name)
TARGETS = [
    ("w600k_mbf.onnx",    "w600k_mbf_int8.onnx"),    # 13MB → ~3.5MB
    ("det_500m.onnx",     "det_500m_int8.onnx"),      # 2.4MB → ~0.6MB
    ("minifasnet_v2.onnx","minifasnet_v2_int8.onnx"), # 268KB → ~80KB
]

def quantize(input_path: Path, output_path: Path) -> None:
    before = input_path.stat().st_size / 1024 / 1024
    print(f"\n  Quantizing: {input_path.name}")
    print(f"  Input size: {before:.2f} MB")

    quantize_dynamic(
        model_input=str(input_path),
        model_output=str(output_path),
        weight_type=QuantType.QUInt8,
        # Quantize all MatMul and Gemm ops (the bulk of the weights)
        per_channel=False,
        reduce_range=False,
    )

    after = output_path.stat().st_size / 1024 / 1024
    ratio = before / after
    print(f"  Output size: {after:.2f} MB  ({ratio:.1f}x smaller)")

def main():
    print("=" * 55)
    print("  FaceAuth Model Quantizer (Float32 → UInt8 INT8)")
    print("=" * 55)

    if not MODELS_DIR.exists():
        print(f"ERROR: Models directory not found: {MODELS_DIR}")
        sys.exit(1)

    total_before = 0.0
    total_after  = 0.0

    for src_name, dst_name in TARGETS:
        input_path  = MODELS_DIR / src_name
        output_path = MODELS_DIR / dst_name

        if not input_path.exists():
            print(f"\n  SKIP (not found): {src_name}")
            continue

        try:
            quantize(input_path, output_path)
            total_before += input_path.stat().st_size / 1024 / 1024
            total_after  += output_path.stat().st_size / 1024 / 1024
        except Exception as e:
            print(f"\n  ERROR quantizing {src_name}: {e}")

    print("\n" + "=" * 55)
    print(f"  TOTAL BEFORE: {total_before:.2f} MB")
    print(f"  TOTAL AFTER:  {total_after:.2f} MB")
    print(f"  SAVINGS:      {total_before - total_after:.2f} MB ({(1 - total_after/total_before)*100:.0f}% reduction)")
    print("=" * 55)
    print("\nNext step: update MODEL_FILES in constants.ts to use *_int8.onnx")
    print("Then delete original Float32 models.")

if __name__ == "__main__":
    main()
