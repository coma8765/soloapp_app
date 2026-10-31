#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Apple Silicon backend. The game itself keeps its existing C++ dependencies.
export UV_CACHE_DIR="$PWD/.cache/uv"
[ -x .cache/whisper-venv/bin/python ] || uv venv --python 3.12 .cache/whisper-venv
uv pip install --python .cache/whisper-venv/bin/python mlx-whisper==0.4.3
hf download mlx-community/whisper-large-v3-turbo-4bit --revision 0f058d38170d183f9fdee07908f5b515d91793a8 --local-dir .cache/whisper-model
# mlx-whisper 0.4.3 expects this filename; the model repository uses model.*.
ln -sf model.safetensors .cache/whisper-model/weights.safetensors
