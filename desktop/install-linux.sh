#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$project_dir/release/linux-unpacked"
install_dir="$HOME/.local/share/trace"
applications_dir="$HOME/.local/share/applications"
test -x "$source_dir/trace" || { echo 'Run npm run package:linux first.' >&2; exit 1; }
mkdir -p "$install_dir" "$applications_dir"
cp -a "$source_dir/." "$install_dir/"

cat > "$install_dir/launch.sh" <<'LAUNCH'
#!/usr/bin/env bash
set -e
# A terminal launched inside Snap can inherit incompatible GTK schemas.
unset GSETTINGS_SCHEMA_DIR
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$app_dir/trace" --ozone-platform=x11 --disable-features=Vulkan --gtk-version=3 "$@"
LAUNCH
chmod +x "$install_dir/launch.sh"
cat > "$install_dir/trace.svg" <<'ICON'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#0d1112"/><circle cx="128" cy="136" r="73" fill="none" stroke="#91efc5" stroke-width="15"/><path d="M128 93v45l30 19M108 33h40" fill="none" stroke="#91efc5" stroke-width="15" stroke-linecap="round"/></svg>
ICON
cat > "$applications_dir/trace.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Trace
Comment=Local screen and work-session tracker
Exec="$install_dir/launch.sh"
Icon=$install_dir/trace.svg
Terminal=false
Categories=Utility;
StartupWMClass=trace
DESKTOP
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$applications_dir"
fi
printf 'Installed Trace in %s\nFind Trace in your applications menu.\n' "$install_dir"
