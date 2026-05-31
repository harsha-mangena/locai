#!/usr/bin/env bash
# Build the llama.cpp inference backend LocAI links against.
# Run once after cloning. Requires: cmake, a C/C++ compiler.
#   macOS:   builds with Metal
#   Linux:   add -DGGML_CUDA=ON or -DGGML_VULKAN=ON as appropriate
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
mkdir -p "$VENDOR"

if [ ! -d "$VENDOR/llama.cpp" ]; then
  echo "→ cloning llama.cpp…"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$VENDOR/llama.cpp"
fi

cd "$VENDOR/llama.cpp"

EXTRA_FLAGS=""
case "$(uname -s)" in
  Darwin) EXTRA_FLAGS="-DGGML_METAL=ON" ;;
  Linux)  EXTRA_FLAGS="-DGGML_VULKAN=ON" ;; # or -DGGML_CUDA=ON
esac

echo "→ configuring ($EXTRA_FLAGS)…"
cmake -B build $EXTRA_FLAGS -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release

echo "→ building llama-server + llama-cli…"
cmake --build build --config Release -j"$(getconf _NPROCESSORS_ONLN)" \
  --target llama-cli llama-server

echo "✓ built: $VENDOR/llama.cpp/build/bin/llama-server"
