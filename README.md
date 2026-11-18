# AirGnomeUI

A Gnome extension frontend for owly to use AirDrop on the Gnome Desktop.

AirGnomeUI provides a Quick Settings control and GNOME windows for sending and
receiving files with [owly](https://github.com/t4t5/owly). It uses owly's
AirDrop-compatible radio and transfer functionality; owly must be installed
separately.

**Small note here:** *I know "vibe-coding" or using AI to code in general is very much frowned upon, so I am sorry, if this offends anyone. If it makes you feel better, I never had or have the intention to actually upload this to extensions.gnome.org - I just really wanted to have this feature on my gnome desktop, didn't find a good extension for it, so I "made" my own one. The only reason this is on GitHub is so that I dont loose the code in case I reinstall my system and beause maybe someone else finds this useful too, even if it is not made by a human. If anyone wants to code this extension for real, I'd be happy to help (without AI obviously), I just personally have little knowledge about JavaScript.*

**Features**

- Toggle the owly radio from Quick Settings and open Send, Receive or Settings
  from the tile's menu.
- Select local files, see reported send progress, and abort a transfer after
  one minute.
- Choose a receive destination and accept transfers automatically or manually.
- Configure the device name, receiver search, interface and receive port.

### Interface

The Quick Settings and Settings screenshots show the earlier **AirDrop** name;
the current extension is named **AirGnomeUI**.

| Quick Settings | Send |
|:---:|:---:|
| <img src="AirGnomeUI%20Quick%20Settings.png" alt="Quick Settings tile and menu" width="382"> | <img src="AirGnomeUI%20Send%20Menu.jpg" alt="Send window with file selection" width="519"> |
| **Receive** | **Settings** |
| <img src="AirGnomeUI%20Receive%20Menu.jpg" alt="Receive window and destination selector" width="519"> | <img src="AirGnomeUI%20Settings%20Menu.jpg" alt="AirGnomeUI settings window" width="644"> |

## Installation

### Requirements

- GNOME Shell **50**; other versions have not been verified.
- GJS, GTK 4, libadwaita, libsoup 3 and the `gnome-extensions` command.
- [owly](https://github.com/t4t5/owly#install), its radio service and a
  [supported wireless adapter](https://github.com/t4t5/owly#supported-hardware).
  Some adapters temporarily disconnect Wi-Fi while the radio is active.

Install the GNOME dependencies using your distribution's package manager. Follow
the [owly installation instructions](https://github.com/t4t5/owly#install) for
your system, or use **Settings → Install Owly** after installing the extension.
The settings installer supports Debian/Ubuntu and Fedora on x86-64, downloads
the latest official release, checks its published SHA-256 digest and opens it
in GNOME Software for confirmation.

### Install from source

Clone the repository and enter its directory:

```sh
git clone https://github.com/maze404/AirGnomeUI.git
cd AirGnomeUI
```

Then create and install the extension bundle:

```sh
gnome-extensions pack --extra-source=common.js --extra-source=app \
  --extra-source=prefs --extra-source=shell .
gnome-extensions install airdrop@maze404.github.io.shell-extension.zip
gnome-extensions enable airdrop@maze404.github.io
```

The package includes the schema XML; the generated ZIP and locally compiled
schema are not tracked by Git. If GNOME Shell does not detect the new
extension, log out and back in, then run the enable command again.

### Updating or uninstalling

After updating the source, run the packaging command again with `--force`, then
install the new ZIP with `gnome-extensions install --force
airdrop@maze404.github.io.shell-extension.zip`. Close existing transfer and
settings windows and reload the extension when no transfer is in progress.
Logging out and back in ensures GNOME Shell loads the updated code.

To remove the installed extension:

```sh
gnome-extensions disable airdrop@maze404.github.io
gnome-extensions uninstall airdrop@maze404.github.io
```

The UUID and settings identifiers retain the earlier `airdrop` name for
compatibility. Uninstalling the extension does not uninstall owly or erase its
settings.

## Usage

Open GNOME's Quick Settings panel and click **AirGnomeUI** to turn the radio on.
Use the arrow on the tile to open **Send**, **Receive** or **Settings**. The
radio must be on before a transfer can start.

### Sending

Select **Send**, choose one or more local files with **Browse** (or drag them
into the window), then select **Start transfer**. Progress is based on owly's
reported byte counts; while searching or waiting for a receiver, the button
shows indeterminate progress. An **Abort** button appears after one minute.
Keep the Send window open during the transfer.

### Receiving

Choose **Receive**, select a destination, and select **Enable Receive**.
Wait for **Ready to receive files** before sending from the other device.

The **Accept Automatically** setting is enabled by default and passes
`--accept` to owly. Turn it off to see an Accept/Decline dialog for each
incoming request. Answer promptly: owly allows 15 seconds for a response.
Changes to this setting take effect the next time receiving is enabled.

Owly 0.4.3 does not report receive byte progress. File progress bars therefore
pulse while receiving; success is shown only when owly reports the saved files.
If the receiver cannot start, its error appears in the Receive window. The
receive window must remain open while receiving.

## Settings

- **Device Name** is shown to other devices. It defaults to your computer's
  hostname; clear it to restore that default.
- **Preferred Receiver** optionally restricts sending to a receiver matching
  its name, service ID or AWDL address. Leave it empty to use the first
  receiver owly finds.
- **Search Time** controls how long owly searches for a receiver. **Wake Apple
  Devices** sends a Bluetooth LE advertisement to help receivers notice it.
- **Destination folder** defaults to Downloads. **Accept Automatically** is
  enabled by default; disable it to confirm each incoming transfer.
- **Transfer Interface** is the network interface used by owly to send and
  receive. `awdl0` is normally correct, even if it is absent while the radio is
  off. Physical Wi-Fi interfaces generally should not be selected here. The
  refresh button updates the list, which also retains previously configured
  interfaces.
- **Owly Command** normally stays as `owly`. An executable path is useful only
  for a nonstandard installation.
- **Receive Port** defaults to TCP port 8771; the firewall must allow it on the
  transfer interface.
- **Install Owly** downloads the official latest release for supported
  Debian/Ubuntu and Fedora x86-64 systems, verifies its release SHA-256 digest,
  and opens the package in GNOME Software. Review and confirm installation
  there; the system package manager handles dependencies. Other distributions,
  architectures, and systems without GNOME Software can use the official
  installation instructions instead.

## Troubleshooting

- **Radio does not start:** Confirm that owly and its radio service are
  installed and that your adapter is supported. Check the error notification
  and the [owly documentation](https://github.com/t4t5/owly).
- **Device not found or waiting:** Unlock the receiving device and enable
  AirDrop discovery. Confirm the radio is on, the interface is correct, and the
  firewall allows the configured receive port. Wireless support and transfer
  reliability depend on owly, the adapter and its driver; consult owly's
  [known issues](https://github.com/t4t5/owly#known-issues).
- **Preferences cannot install owly:** Use the official installation
  instructions if your platform is unsupported or GNOME Software is missing.

## Privacy

AirGnomeUI does not create diagnostic logs. Logs from earlier versions are not
deleted automatically; if present, they can be removed from
`$XDG_STATE_HOME/airdrop/` (normally `~/.local/state/airdrop/`).

## Maintenance and distribution

This code was generated with AI for personal use. Do not upload it to
extensions.gnome.org unless you understand and can maintain the JavaScript.
The GNOME AI guidance asks a qualified maintainer to review the code and
manually remove the source notices before submission. This project has not
been submitted or approved, and its copyright holder must choose a
GPL-compatible license before distribution. AirDrop is an Apple trademark;
AirGnomeUI is not affiliated with or endorsed by Apple. References to AirDrop
should be reviewed before publication.
