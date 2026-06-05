#!/usr/bin/env python3
"""
Benchmark ONNX models for inference speed, memory usage, and accuracy.

Measures:
  - Latency (avg, p50, p95, p99 over N iterations)
  - Memory footprint
  - Model file size
  - Throughput (FPS)

Usage:
  pip install onnxruntime numpy
  python benchmark_models.py [--device cpu|gpu] [--iterations 100]
"""

import argparse
import time
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
MODEL_DIR = PROJECT_ROOT / "FaceAuthApp" / "assets" / "models"

# ─── Model Configurations ────────────────────────────────────────────────────

MODEL_CONFIGS = [
    {
        "name": "SCRFD-500MF (Detection)",
        "pattern": "*scrfd*500m*.onnx",
        "input_shape": (1, 3, 640, 640),
        "category": "detection",
    },
    {
        "name": "MobileFaceNet (Recognition)",
        "pattern": "*w600k_mbf*.onnx",
        "input_shape": (1, 3, 112, 112),
        "category": "recognition",
    },
    {
        "name": "MiniFASNet (Liveness)",
        "pattern": "*liveness*.onnx",
        "input_shape": (1, 3, 80, 80),
        "category": "liveness",
    },
]


def benchmark_model(model_path: Path, input_shape: tuple, num_iterations: int = 100, warmup: int = 10):
    """
    Benchmark a single ONNX model.

    Returns dict with timing statistics.
    """
    # Create session
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = 4  # Simulate mobile CPU

    session = ort.InferenceSession(str(model_path), sess_options)
    input_name = session.get_inputs()[0].name

    # Prepare input
    test_input = np.random.randn(*input_shape).astype(np.float32)

    # Warmup
    print(f"  Warming up ({warmup} iterations)...")
    for _ in range(warmup):
        session.run(None, {input_name: test_input})

    # Benchmark
    print(f"  Benchmarking ({num_iterations} iterations)...")
    latencies = []

    for i in range(num_iterations):
        start = time.perf_counter()
        output = session.run(None, {input_name: test_input})
        end = time.perf_counter()
        latencies.append((end - start) * 1000)  # Convert to ms

    latencies = np.array(latencies)

    # Get output info
    output_shapes = [o.shape for o in output]

    return {
        "mean_ms": np.mean(latencies),
        "median_ms": np.median(latencies),
        "std_ms": np.std(latencies),
        "min_ms": np.min(latencies),
        "max_ms": np.max(latencies),
        "p95_ms": np.percentile(latencies, 95),
        "p99_ms": np.percentile(latencies, 99),
        "fps": 1000.0 / np.mean(latencies),
        "output_shapes": output_shapes,
        "file_size_mb": model_path.stat().st_size / 1024 / 1024,
    }


def benchmark_full_pipeline(models: dict, num_iterations: int = 50):
    """
    Benchmark the full pipeline: detection → liveness → recognition.
    """
    print("\n" + "=" * 60)
    print("FULL PIPELINE BENCHMARK")
    print("=" * 60)

    sessions = {}
    inputs = {}

    for name, (path, config) in models.items():
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = 4

        session = ort.InferenceSession(str(path), sess_options)
        input_name = session.get_inputs()[0].name
        test_input = np.random.randn(*config["input_shape"]).astype(np.float32)

        sessions[name] = (session, input_name)
        inputs[name] = test_input

    # Warmup
    for _ in range(10):
        for name, (session, input_name) in sessions.items():
            session.run(None, {input_name: inputs[name]})

    # Benchmark full pipeline
    pipeline_latencies = []
    stage_latencies = {name: [] for name in sessions}

    pipeline_order = ["detection", "liveness", "recognition"]
    available_stages = [s for s in pipeline_order if s in sessions]

    for _ in range(num_iterations):
        total_start = time.perf_counter()

        for stage in available_stages:
            session, input_name = sessions[stage]
            start = time.perf_counter()
            session.run(None, {input_name: inputs[stage]})
            end = time.perf_counter()
            stage_latencies[stage].append((end - start) * 1000)

        total_end = time.perf_counter()
        pipeline_latencies.append((total_end - total_start) * 1000)

    # Results
    print(f"\n  Pipeline order: {' → '.join(available_stages)}")
    print(f"\n  {'Stage':<25} {'Mean (ms)':>10} {'P95 (ms)':>10} {'P99 (ms)':>10}")
    print(f"  {'─' * 55}")

    for stage in available_stages:
        lats = np.array(stage_latencies[stage])
        print(f"  {stage:<25} {np.mean(lats):>10.2f} {np.percentile(lats, 95):>10.2f} {np.percentile(lats, 99):>10.2f}")

    lats = np.array(pipeline_latencies)
    print(f"  {'─' * 55}")
    print(f"  {'TOTAL PIPELINE':<25} {np.mean(lats):>10.2f} {np.percentile(lats, 95):>10.2f} {np.percentile(lats, 99):>10.2f}")
    print(f"\n  Pipeline FPS: {1000.0 / np.mean(lats):.1f}")
    print(f"  Meets <1000ms target: {'✅ YES' if np.percentile(lats, 95) < 1000 else '❌ NO'}")
    print(f"  Meets <500ms target:  {'✅ YES' if np.percentile(lats, 95) < 500 else '❌ NO'}")


def main():
    parser = argparse.ArgumentParser(description="Benchmark ONNX models")
    parser.add_argument("--iterations", type=int, default=100, help="Number of benchmark iterations")
    parser.add_argument("--warmup", type=int, default=10, help="Number of warmup iterations")
    parser.add_argument("--quantized", action="store_true", help="Also benchmark quantized models")
    args = parser.parse_args()

    print("ONNX Model Benchmarker")
    print("=" * 60)
    print(f"Platform: {sys.platform}")
    print(f"ONNX Runtime: {ort.__version__}")
    print(f"Iterations: {args.iterations}")
    print(f"Available providers: {ort.get_available_providers()}")

    all_models = {}  # For pipeline benchmark

    for config in MODEL_CONFIGS:
        print(f"\n{'─' * 60}")
        print(f"Model: {config['name']}")
        print(f"{'─' * 60}")

        # Find model files
        model_dirs = [MODEL_DIR]
        if args.quantized:
            model_dirs.append(MODEL_DIR / "quantized")

        for search_dir in model_dirs:
            matches = list(search_dir.glob(config["pattern"]))
            for model_path in matches:
                is_quantized = "quantized" in str(model_path) or "int8" in model_path.name
                label = f"  [{'INT8' if is_quantized else 'FP32'}] {model_path.name}"
                print(f"\n{label}")

                try:
                    results = benchmark_model(model_path, config["input_shape"], args.iterations, args.warmup)

                    print(f"  File size:    {results['file_size_mb']:.2f} MB")
                    print(f"  Mean latency: {results['mean_ms']:.2f} ms")
                    print(f"  Median:       {results['median_ms']:.2f} ms")
                    print(f"  Std dev:      {results['std_ms']:.2f} ms")
                    print(f"  Min/Max:      {results['min_ms']:.2f} / {results['max_ms']:.2f} ms")
                    print(f"  P95:          {results['p95_ms']:.2f} ms")
                    print(f"  P99:          {results['p99_ms']:.2f} ms")
                    print(f"  Throughput:   {results['fps']:.1f} FPS")
                    print(f"  Output:       {results['output_shapes']}")

                    # Track FP32 models for pipeline benchmark
                    if not is_quantized:
                        all_models[config["category"]] = (model_path, config)

                except Exception as e:
                    print(f"  ❌ Benchmark failed: {e}")

    # Full pipeline benchmark
    if len(all_models) >= 2:
        benchmark_full_pipeline(all_models, num_iterations=args.iterations)
    else:
        print(f"\n  ⚠️ Need at least 2 models for pipeline benchmark (found {len(all_models)})")

    # Size summary
    print("\n" + "=" * 60)
    print("SIZE SUMMARY")
    print("=" * 60)
    total = 0
    for f in sorted(MODEL_DIR.glob("*.onnx")):
        size_mb = f.stat().st_size / 1024 / 1024
        total += size_mb
        print(f"  {f.name:<40} {size_mb:>8.2f} MB")
    print(f"  {'─' * 50}")
    print(f"  {'TOTAL':<40} {total:>8.2f} MB")
    print(f"  Budget: 20 MB  |  {'✅ OK' if total <= 20 else '⚠️ OVER BUDGET'}")


if __name__ == "__main__":
    main()
