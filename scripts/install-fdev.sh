#!/usr/bin/env sh
set -eu

repo="${FDEV_REPO:-freestyle-sh/fdev}"
version="${FDEV_VERSION:-latest}"
fdev_home="${FDEV_HOME:-$HOME/.fdev}"
install_dir="${FDEV_INSTALL_DIR:-$fdev_home/bin}"

os="$(uname -s)"
arch="$(uname -m)"
shell_name="$(basename "${SHELL:-}")"

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

update_path() {
  case ":$PATH:" in
    *":$install_dir:"*) return ;;
  esac

  if [ "${FDEV_NO_MODIFY_PATH:-}" = "1" ]; then
    print_path_instructions
    return
  fi

  profile="$(detect_profile)"
  if [ -z "$profile" ]; then
    print_path_instructions
    return
  fi

  mkdir -p "$(dirname "$profile")"
  touch "$profile"

  if grep -F "$install_dir" "$profile" >/dev/null 2>&1; then
    echo ""
    echo "fdev install directory is already referenced in $profile"
    print_current_shell_instructions
    return
  fi

  case "$profile" in
    *.fish)
      {
        echo ""
        echo "# fdev"
        echo "fish_add_path \"$install_dir\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
    *)
      {
        echo ""
        echo "# fdev"
        echo "export PATH=\"$install_dir:\$PATH\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
  esac

  echo ""
  echo "Added fdev to PATH and enabled shell completion in $profile"
  print_current_shell_instructions
}

detect_profile() {
  if [ -n "${FDEV_PROFILE:-}" ]; then
    echo "$FDEV_PROFILE"
    return
  fi

  case "$shell_name" in
    zsh)
      echo "$HOME/.zshrc"
      return
      ;;
    bash)
      if [ "$os_name" = "darwin" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      return
      ;;
    fish)
      echo "$HOME/.config/fish/config.fish"
      return
      ;;
  esac

  if [ -f "$HOME/.zshrc" ]; then
    echo "$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    echo "$HOME/.bashrc"
  elif [ -f "$HOME/.profile" ]; then
    echo "$HOME/.profile"
  else
    echo "$HOME/.profile"
  fi
}

print_path_instructions() {
  echo ""
  echo "Add this to your shell profile:"
  case "$shell_name" in
    fish)
      echo "  fish_add_path \"$install_dir\""
      echo "  $(completion_profile_line)"
      ;;
    *)
      echo "  export PATH=\"$install_dir:\$PATH\""
      echo "  $(completion_profile_line)"
      ;;
  esac
  print_current_shell_instructions
}

print_current_shell_instructions() {
  echo "Restart your shell, or run this now:"
  case "$shell_name" in
    fish)
      echo "  set -gx PATH \"$install_dir\" \$PATH"
      echo "  $(completion_profile_line)"
      ;;
    *)
      echo "  export PATH=\"$install_dir:\$PATH\""
      echo "  $(completion_profile_line)"
      ;;
  esac
}

completion_profile_line() {
  case "$shell_name" in
    fish) echo "fdev completion fish | source" ;;
    bash) echo "eval \"\$(fdev completion bash)\"" ;;
    *) echo "eval \"\$(fdev completion zsh)\"" ;;
  esac
}

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

update_path

"$install_dir/fdev" --version
