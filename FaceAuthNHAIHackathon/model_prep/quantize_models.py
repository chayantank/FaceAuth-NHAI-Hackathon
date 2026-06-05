#!/usr/bin/env python3
"""
Quantize ONNX models from FP32 to INT8 for mobile deployment.

Supports both dynamic quantization (no calibration data needed) and
static quantization (requires representative face images for calibration).

Usage:
  pip install onnxruntime onnx numpy Pillow
  python quantize_models.py [--static --calib-dir /path/to/face/images]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import (
    quantize_dynamic,
    quantize_static,
    QuantType,
    QuantFormat,
    CalibrationDataReader,
)

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
MODEL_DIR = PROJECT_ROOT / "FaceAuthApp" / "assets" / "models"
OUTPUT_DIR = MODEL_DIR / "quantized"


# ─── Calibration Data Reader for Static Quantization ─────────────────────────

class FaceCalibrationDataReader(CalibrationDataReader):
    """Reads face images for static quantization calibration."""

    def __init__(self, calib_dir: Path, input_name: str, input_shape: tuple, num_samples: int = 100):
        self.input_name = input_name
        self.input_shape = input_shape
        self.idx = 0

        # Load and preprocess calibration images
        self.data = []
        if calib_dir and calib_dir.exists():
            from PIL import Image

            image_files = list(calib_dir.glob("*.jpg")) + list(calib_dir.glob("*.png"))
            image_files = image_files[:num_samples]

            h, w = input_shape[2], input_shape[3]
            for img_path in image_files:
                img = Image.open(img_path).convert("RGB").resize((w, h))
                arr = np.array(img, dtype=np.float32) / 255.0
                arr = arr.transpose(2, 0, 1)  # HWC -> CHW
                arr = np.expand_dims(arr, 0)
                self.data.append(arr)

            print(f"  Loaded {len(self.data)} calibration images")
        else:
            # Generate random calibration data if no images provided
            print(f"  Using random calibration data ({num_samples} samples)")
            for _ in range(num_samples):
                self.data.append(np.random.randn(*input_shape).astype(np.float32))

    def get_next(self):
        if self.idx < len(self.data):
            result = {self.input_name: self.data[self.idx]}
            self.idx += 1
            return result
        return None


# ─── Model Configurations ────────────────────────────────────────────────────

MODEL_CONFIGS = {
    "scrfd": {
        "pattern": "*scrfd*500m*.onnx",
        "input_shape": (1, 3, 640, 640),
        "description": "SCRFD-500MF Face Detection",
    },
    "recognition": {
        "pattern": "*w600k_mbf*.onnx",
        "input_shape": (1, 3, 112, 112),
        "description": "MobileFaceNet Face Recognition",
    },
    "liveness": {
        "pattern": "*liveness*.onnx",
        "input_shape": (1, 3, 80, 80),
        "description": "MiniFASNet Liveness Detection",
    },
}


def get_input_name(model_path: Path) -> str:
    """Get the input tensor name from an ONNX model."""
    session = ort.InferenceSession(str(model_path))
    return session.get_inputs()[0].name


def quantize_model_dynamic(model_path: Path, output_path: Path):
    """Apply dynamic INT8 quantization (no calibration needed)."""
    print(f"  Dynamic INT8 quantization...")
    quantize_dynamic(
        model_input=str(model_path),
        model_output=str(output_path),
        weight_type=QuantType.QUInt8,
    )


def quantize_model_static(model_path: Path, output_path: Path, config: dict, calib_dir: Path):
    """Apply static INT8 quantization (needs calibration data)."""
    print(f"  Static INT8 quantization with calibration...")

    input_name = get_input_name(model_path)
    reader = FaceCalibrationDataReader(
        calib_dir=calib_dir,
        input_name=input_name,
        input_shape=config["input_shape"],
    )

    # Pre-process: optimize model before quantization
    from onnxruntime.quantization import shape_inference
    preprocessed_path = output_path.parent / f"{model_path.stem}_preprocessed.onnx"
    shape_inference.quant_pre_process(
        str(model_path), str(preprocessed_path), skip_symbolic_shape=True
    )

    quantize_static(
        model_input=str(preprocessed_path),
        model_output=str(output_path),
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,  # Better accuracy for depthwise conv
    )

    # Clean up preprocessed model
    preprocessed_path.unlink(missing_ok=True)


def verify_quantized_model(original_path: Path, quantized_path: Path, input_shape: tuple):
    """Compare outputs between original and quantized models."""
    print(f"  Verifying quantized model...")

    orig_session = ort.InferenceSession(str(original_path))
    quant_session = ort.InferenceSession(str(quantized_path))

    input_name = orig_session.get_inputs()[0].name
    test_input = np.random.randn(*input_shape).astype(np.float32)

    orig_output = orig_session.run(None, {input_name: test_input})[0]

    quant_input_name = quant_session.get_inputs()[0].name
    quant_output = quant_session.run(None, {quant_input_name: test_input})[0]

    # Calculate difference
    max_diff = np.max(np.abs(orig_output - quant_output))
    mean_diff = np.mean(np.abs(orig_output - quant_output))
    cosine_sim = np.dot(orig_output.flatten(), quant_output.flatten()) / (
        np.linalg.norm(orig_output) * np.linalg.norm(quant_output) + 1e-8
    )

    print(f"    Max absolute diff:  {max_diff:.6f}")
    print(f"    Mean absolute diff: {mean_diff:.6f}")
    print(f"    Cosine similarity:  {cosine_sim:.6f}")

    return cosine_sim > 0.95


def main():
    parser = argparse.ArgumentParser(description="Quantize ONNX models for mobile deployment")
    parser.add_argument("--static", action="store_true", help="Use static quantization (needs calibration data)")
    parser.add_argument("--calib-dir", type=Path, help="Directory with calibration face images")
    parser.add_argument("--model", choices=list(MODEL_CONFIGS.keys()), help="Quantize specific model only")
    args = parser.parse_args()

    print("ONNX Model Quantizer")
    print("=" * 60)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    models_to_process = {args.model: MODEL_CONFIGS[args.model]} if args.model else MODEL_CONFIGS

    results = []
    for name, config in models_to_process.items():
        print(f"\n{'─' * 60}")
        print(f"Model: {config['description']}")
        print(f"{'─' * 60}")

        # Find the model file
        matches = list(MODEL_DIR.glob(config["pattern"]))
        if not matches:
            print(f"  ⚠️ No model found matching: {config['pattern']}")
            continue

        model_path = matches[0]
        orig_size = model_path.stat().st_size / 1024 / 1024
        print(f"  Source: {model_path.name} ({orig_size:.2f} MB)")

        output_path = OUTPUT_DIR / f"{model_path.stem}_int8.onnx"

        try:
            if args.static:
                quantize_model_static(model_path, output_path, config, args.calib_dir)
            else:
                quantize_model_dynamic(model_path, output_path)

            quant_size = output_path.stat().st_size / 1024 / 1024
            reduction = (1 - quant_size / orig_size) * 100

            print(f"  Output: {output_path.name} ({quant_size:.2f} MB)")
            print(f"  Reduction: {reduction:.1f}%")

            # Verify
            passed = verify_quantized_model(model_path, output_path, config["input_shape"])
            status = "✅ PASSED" if passed else "⚠️ LOW SIMILARITY — consider FP16"

            results.append({
                "name": name,
                "original_mb": orig_size,
                "quantized_mb": quant_size,
                "reduction_pct": reduction,
                "status": status,
            })
            print(f"  Verification: {status}")

        except Exception as e:
            print(f"  ❌ Quantization failed: {e}")
            results.append({"name": name, "status": f"❌ FAILED: {e}"})

    # Final summary
    print("\n" + "=" * 60)
    print("QUANTIZATION SUMMARY")
    print("=" * 60)
    print(f"{'Model':<20} {'Original':>10} {'Quantized':>10} {'Reduction':>10} {'Status'}")
    print("─" * 70)

    total_orig = 0
    total_quant = 0
    for r in results:
        if "original_mb" in r:
            total_orig += r["original_mb"]
            total_quant += r["quantized_mb"]
            print(f"{r['name']:<20} {r['original_mb']:>8.2f}MB {r['quantized_mb']:>8.2f}MB {r['reduction_pct']:>8.1f}%  {r['status']}")
        else:
            print(f"{r['name']:<20} {'—':>10} {'—':>10} {'—':>10}  {r['status']}")

    if total_orig > 0:
        print("─" * 70)
        total_reduction = (1 - total_quant / total_orig) * 100
        print(f"{'TOTAL':<20} {total_orig:>8.2f}MB {total_quant:>8.2f}MB {total_reduction:>8.1f}%")


if __name__ == "__main__":
    main()
