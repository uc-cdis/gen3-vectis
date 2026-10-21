#!/usr/bin/env bash
# Gen3 SDK wheels for the in-browser (free) JupyterLite, from released, hash-pinned packages (config/jupyterlite/*.lock).
# Replaces the framework's step that built nine repos from git master. Output: <build_dir>/pypi/*.whl, read by build-jupyterlite.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAMEWORK="$ROOT/node_modules/@gen3/workspaces/dist/jupyterlite-builds/scripts"
LOCKS="$ROOT/config/jupyterlite"

# shellcheck disable=SC1091
source "$FRAMEWORK/setup-env.sh" "${1:-builds}"
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

OUT="$BUILD_DIR/pypi"
SRC="$BUILD_DIR/gen3-sdists"
rm -rf "$OUT" "$SRC"
mkdir -p "$OUT" "$SRC"

uv pip install --quiet pip wheel setuptools

echo "[gen3-lite] downloading released wheels"
python -m pip download -r "$LOCKS/gen3-wheels.lock" --require-hashes --no-deps --only-binary=:all: \
  --python-version 314 --platform any -d "$OUT" --quiet

echo "[gen3-lite] building packages that have no browser wheel"
# pip would build the sdist's metadata just to download it (fastavro asks for Cython, which needs a compiler), so fetch the archives directly.
python - "$LOCKS/gen3-sdists.lock" "$SRC" <<'PY'
import hashlib, json, re, sys, urllib.request
lock, dest = sys.argv[1:3]
for name, version, digest in re.findall(r"^([A-Za-z0-9_.-]+)==(\S+) \\\n\s+--hash=sha256:([0-9a-f]{64})", open(lock).read(), re.M):
    files = json.load(urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json"))["urls"]
    sdist = next(f for f in files if f["packagetype"] == "sdist" and f["digests"]["sha256"] == digest)
    data = urllib.request.urlopen(sdist["url"]).read()
    if hashlib.sha256(data).hexdigest() != digest:
        sys.exit(f"{name}=={version}: hash mismatch")
    open(f"{dest}/{sdist['filename']}", "wb").write(data)
PY
for archive in "$SRC"/*.tar.gz; do
  name="$(basename "$archive" .tar.gz)"
  tar -xzf "$archive" -C "$SRC"
  # fastavro's setup.py builds its C extensions unless it runs on PyPy; skip them (it falls back to Python).
  if [[ "$name" == fastavro-* ]]; then
    sed -i.bak 's/if not hasattr(sys, "pypy_version_info"):/if False:/' "$SRC/$name/setup.py"
    export FASTAVRO_USE_PYTHON=1
  fi
  (cd "$SRC/$name" && pip wheel . --no-deps --no-build-isolation -w dist/ --quiet \
    && python -m wheel tags --python-tag py3 --abi-tag none --platform-tag any --remove dist/*.whl > /dev/null)
  cp "$SRC/$name"/dist/*.whl "$OUT/"
done

# Anything with a platform tag cannot load in the browser.
for wheel in "$OUT"/*.whl; do
  case "$(basename "$wheel")" in
    *-py3-none-any.whl|*-py2.py3-none-any.whl) ;;
    *) echo "[gen3-lite] not pure Python: $(basename "$wheel")" >&2; exit 1 ;;
  esac
done
echo "[gen3-lite] $(ls -1 "$OUT"/*.whl | wc -l | tr -d ' ') wheels in $OUT"
