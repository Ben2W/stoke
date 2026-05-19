#!/usr/bin/env sh
set -eu

repo="${RIGKIT_REPO:-freestyle-sh/rigkit}"
version="${RIGKIT_VERSION:-latest}"
rigkit_home="${RIGKIT_HOME:-$HOME/.rigkit}"
install_dir="${RIGKIT_INSTALL_DIR:-$rigkit_home/bin}"

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

asset="rig-${os_name}-${arch_name}.tar.gz"
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
    *":$install_dir:"*)
      echo ""
      echo "Shell setup"
      echo "  rig is already on PATH for this terminal."
      print_current_shell_instructions
      return
      ;;
  esac

  if [ "${RIGKIT_NO_MODIFY_PATH:-}" = "1" ]; then
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
    echo "Shell setup"
    echo "  $profile already references $install_dir."
    print_profile_refresh_instructions "$profile"
    return
  fi

  case "$profile" in
    *.fish)
      {
        echo ""
        echo "# rigkit"
        echo "fish_add_path \"$install_dir\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
    *)
      {
        echo ""
        echo "# rigkit"
        echo "export PATH=\"$install_dir:\$PATH\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
  esac

  echo ""
  echo "Shell setup"
  echo "  Added rig to PATH and enabled shell completion in $profile."
  print_profile_refresh_instructions "$profile"
}

detect_profile() {
  if [ -n "${RIGKIT_PROFILE:-}" ]; then
    echo "$RIGKIT_PROFILE"
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
  echo "Shell setup"
  echo "  Add this to your shell profile:"
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

print_profile_refresh_instructions() {
  profile="$1"
  shell_label="$shell_name"
  if [ -z "$shell_label" ]; then
    shell_label="your shell"
  fi

  echo "Restart your terminal, or refresh $shell_label now:"
  case "$shell_name" in
    fish|bash|zsh)
      echo "  source \"$profile\""
      ;;
    *)
      echo "  . \"$profile\""
      ;;
  esac
}

print_current_shell_instructions() {
  shell_label="$shell_name"
  if [ -z "$shell_label" ]; then
    shell_label="your shell"
  fi

  echo "Restart your terminal, or run this command to use rig in $shell_label now:"
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
    fish) echo "rig completion fish | source" ;;
    bash) echo "eval \"\$(rig completion bash)\"" ;;
    *) echo "eval \"\$(rig completion zsh)\"" ;;
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
mv "$tmp_dir/rig-${os_name}-${arch_name}" "$install_dir/rig"
chmod +x "$install_dir/rig"

echo "Installed rig to $install_dir/rig"

"$install_dir/rig" --version

update_path
