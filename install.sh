#!/usr/bin/env bash
set -euo pipefail

REPO="${JEV_REPO:-jackmuva/jev-as-a-workflow}"
VERSION="${JEV_VERSION:-latest}"
INSTALL_DIR="${JEV_INSTALL_DIR:-${HOME}/.local/bin}"
BIN_NAME="${JEV_BIN_NAME:-fl0w}"

usage() {
  cat <<EOF
Usage: install.sh

Environment variables:
  JEV_VERSION      Release tag to install (default: latest)
  JEV_INSTALL_DIR  Directory for the binary (default: ~/.local/bin)
  JEV_BIN_NAME     Installed command name (default: fl0w)
  JEV_REPO         GitHub repository (default: jackmuva/jev-as-a-workflow)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

need_cmd uname
need_cmd curl
need_cmd mktemp

detect_os() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)
      echo "error: unsupported operating system: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      echo "error: unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

detect_musl() {
  if [[ "$(detect_os)" != "linux" ]]; then
    return 1
  fi

  if [[ -f /etc/alpine-release ]]; then
    return 0
  fi

  if command -v ldd >/dev/null 2>&1; then
    ldd --version 2>&1 | grep -qi musl && return 0
    ldd /bin/sh 2>&1 | grep -qi musl && return 0
  fi

  return 1
}

resolve_version() {
  if [[ "$VERSION" == "latest" ]]; then
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n 1
  else
    echo "$VERSION"
  fi
}

download() {
  local url="$1"
  local output="$2"
  curl -fsSL "$url" -o "$output"
}

OS="$(detect_os)"
ARCH="$(detect_arch)"

if [[ "$OS" == "windows" ]]; then
  echo "error: use install.ps1 on Windows" >&2
  exit 1
fi

ASSET="fl0w-${OS}-${ARCH}"
if detect_musl; then
  ASSET="${ASSET}-musl"
fi

TAG="$(resolve_version)"
if [[ -z "$TAG" ]]; then
  echo "error: could not resolve release version" >&2
  exit 1
fi

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
ASSET_URL="${BASE_URL}/${ASSET}"
CHECKSUMS_URL="${BASE_URL}/SHA256SUMS"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Installing ${BIN_NAME} ${TAG} (${ASSET})..."

download "$ASSET_URL" "${TMP_DIR}/${ASSET}"
download "$CHECKSUMS_URL" "${TMP_DIR}/SHA256SUMS"

(
  cd "$TMP_DIR"
  grep " ${ASSET}$" SHA256SUMS | sha256sum -c -
)

mkdir -p "$INSTALL_DIR"
install -m 755 "${TMP_DIR}/${ASSET}" "${INSTALL_DIR}/${BIN_NAME}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo
    echo "Add ${INSTALL_DIR} to your PATH:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo
echo "Installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"
echo "Run '${BIN_NAME}' to start fl0w."
