#!/usr/bin/env sh
set -eu

repo="${FDEV_REPO:-freestyle-sh/fdev}"
version="${FDEV_VERSION:-latest}"
install_dir="${FDEV_INSTALL_DIR:-$HOME/.freestyle/bin}"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os_name="darwin" ;;
  Linux) os_name="linux" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) arch_name="arm64" ;;
  x86_64|amd64) arch_name="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="fdev-${os_name}-${arch_name}.tar.gz"
base_url="https://github.com/${repo}/releases"

if [ "$version" = "latest" ]; then
  download_url="${base_url}/latest/download/${asset}"
  checksum_url="${base_url}/latest/download/checksums.txt"
else
  case "$version" in
    v*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
  download_url="${base_url}/download/${tag}/${asset}"
  checksum_url="${base_url}/download/${tag}/checksums.txt"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading ${asset} from ${repo}..."
curl -fsSL "$download_url" -o "$tmp_dir/$asset"
curl -fsSL "$checksum_url" -o "$tmp_dir/checksums.txt"

expected="$(grep " ${asset}$" "$tmp_dir/checksums.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "Could not find checksum for ${asset}" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp_dir/$asset" | awk '{print $1}')"
else
  echo "Could not find shasum or sha256sum to verify download" >&2
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  echo "Checksum mismatch for ${asset}" >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
mkdir -p "$install_dir"
mv "$tmp_dir/fdev-${os_name}-${arch_name}" "$install_dir/fdev"
chmod +x "$install_dir/fdev"

echo "Installed fdev to $install_dir/fdev"

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    echo ""
    echo "Add this to your shell profile:"
    echo "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac

"$install_dir/fdev" --version
