# Install Trace on Windows and Ubuntu

This guide covers the Trace 0.4.0 installers for 64-bit Intel and AMD PCs. Download them from [Trace releases](https://github.com/AlyySync/Trace-event-tracker/releases/latest). Node.js, Rust and development tools are only needed when building from source.

## Choose your download

| Computer | Download | Use |
| --- | --- | --- |
| Windows 10 or 11, x64 | `Trace-0.4.0-windows-x64-setup.exe` | Installer with a Start menu entry |
| Ubuntu 24.04, amd64 | `Trace-0.4.0-ubuntu-24.04-amd64.deb` | Installs through Ubuntu's package manager |
| Ubuntu 24.04, x86_64 | `Trace-0.4.0-linux-x86_64.AppImage` | Run from a file without installing the DEB |

The Linux builds use Ubuntu 24.04. Ubuntu 22.04, other distributions and ARM computers are not validated targets for these downloads. The source ZIP files that GitHub adds to each release are for developers.

## Install on Windows

1. Download and open `Trace-0.4.0-windows-x64-setup.exe`.
2. Follow the setup wizard. Trace installs for your current Windows account.
3. The installer includes the offline Microsoft WebView2 installer, so setup works without an internet connection even when WebView2 is missing. This makes the download larger. See [Tauri's WebView2 installation options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).
4. Open **Trace** from the Start menu.

This release is unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Check that you downloaded it from the repository linked above before deciding whether to continue. On a managed PC, follow your administrator's policy.

## Install on Ubuntu

### Screen sharing on Wayland and Xorg

On the default Ubuntu Wayland session, select **Start tracking** in Trace. Trace detects the connected displays and opens Ubuntu's sharing dialog. If you have two screens, select both displays there. Trace combines their frames into one screenshot and preview. The **Connect** or **Change source** button lets you choose one screen instead. Leave sharing enabled while tracking. Automatic screenshots reuse the approved sharing session, so they do not open a new permission dialog each time. If the dialog is canceled, tracking does not start. If the sharing feed ends, Trace pauses and asks you to reconnect. Individual window selection is available on Xorg and Windows.

On **Ubuntu on Xorg**, Trace lists screens and windows in its own source picker. Screen capture on either session requires a running graphical desktop; it cannot run from a headless SSH session.

### Install the DEB package

Download the `.deb` into your Downloads folder, then run:

```sh
cd ~/Downloads
sudo apt update
sudo apt install ./Trace-0.4.0-ubuntu-24.04-amd64.deb
```

APT installs the required runtime libraries. Open **Trace** from the applications menu. You can also run `trace-desktop` from a terminal to see startup errors. The guide is installed at `/usr/share/doc/trace/INSTALL.md`.

### Run the AppImage

If you prefer the AppImage, download it and run:

```sh
cd ~/Downloads
chmod +x Trace-0.4.0-linux-x86_64.AppImage
./Trace-0.4.0-linux-x86_64.AppImage
```

If it reports that FUSE is unavailable, try its extraction mode:

```sh
./Trace-0.4.0-linux-x86_64.AppImage --appimage-extract-and-run
```

The AppImage does not add itself to the applications menu. Keep the file wherever you want to launch it from. See the [AppImage troubleshooting guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) for FUSE setup.

## Start your first session

1. Open Trace and enter a session name.
2. Select **Start tracking**. On Wayland, approve the detected displays in Ubuntu's sharing dialog and check the combined preview. On Xorg or Windows, choose a screen or window.
3. Select **Capture now**, then open **Captures** to confirm that the screenshot saved.
4. Use **Pause** to stop capture and elapsed time. Resume on Wayland reuses the current sharing sessions; **Change source** opens Ubuntu's chooser again. On Xorg and Windows, Resume asks you to select a source again. Use **Finish** to save the session to Timeline.

Automatic screenshots start with a randomized 1–3 minute interval. You can change it in Preferences. Permission dialogs and real screen capture, sleep and lock behavior still need checking on your PC; successful packaging alone does not verify them.

## Updates and removal

Quit Trace before updating, then install the newer Windows installer or DEB over the existing Tauri version. For AppImage, download and use the newer file. Automatic updates are not configured.

On Windows, remove Trace through **Settings → Apps → Installed apps**. On Ubuntu, remove the DEB with:

```sh
sudo apt remove trace
```

For AppImage, delete the downloaded file after quitting Trace. Uninstalling is separate from deleting your stored sessions and screenshots; back up anything you need before removing app data.

## Your data

Preferences shows the exact location of `trace.sqlite3`. The usual locations are `%APPDATA%\com.trace.app\trace.sqlite3` on Windows and `~/.local/share/com.trace.app/trace.sqlite3` on Ubuntu. Screenshots and session history are stored locally in this database. Quit Trace before backing up its data directory.

The previous Electron app uses a separate data profile. Its sessions and screenshots are not automatically imported into this Tauri release. Export any screenshots you need from the old app before removing it.

## Check a download

The release includes `SHA256SUMS-windows.txt` and `SHA256SUMS-linux.txt`. To check a Windows download, run this in PowerShell and compare the hash with the Windows checksum file:

```powershell
Get-FileHash .\Trace-0.4.0-windows-x64-setup.exe -Algorithm SHA256
```

For the Ubuntu DEB, compare this output with its entry in the Linux checksum file:

```sh
sha256sum Trace-0.4.0-ubuntu-24.04-amd64.deb
```

Checksums help detect incomplete or changed downloads; they are not a code-signing certificate.
