// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {defaultReceiveDir} from './common.js';
import {listTransferInterfaces} from './prefs/interfaces.js';
import {openOwlyInstaller, prepareOwlyInstaller, RELEASES_URL} from './prefs/installer.js';

export function buildSettingsPages(settings, window) {
    const page = new Adw.PreferencesPage({
        title: _('AirGnomeUI'),
        icon_name: 'network-wireless-symbolic',
    });

    const identity = new Adw.PreferencesGroup({
        title: _('Identity'),
        description: _('How this computer appears to nearby devices.'),
    });
    page.add(identity);

    const name = new Adw.ActionRow({
        title: _('Device Name'),
        subtitle: _('Name shown to other devices. Defaults to this computer’s hostname.'),
    });
    const nameEntry = new Gtk.Entry({valign: Gtk.Align.CENTER, width_chars: 20});
    let updatingName = false;
    const updateName = () => {
        updatingName = true;
        nameEntry.text = settings.get_string('device-name') || GLib.get_host_name();
        updatingName = false;
    };
    const applyName = () => {
        if (updatingName)
            return;
        const value = nameEntry.text.trim();
        settings.set_string('device-name', value === GLib.get_host_name() ? '' : value);
        updateName();
    };
    nameEntry.connect('activate', applyName);
    nameEntry.connect('notify::has-focus', () => {
        if (!nameEntry.has_focus)
            applyName();
    });
    const nameChangedId = settings.connect('changed::device-name', updateName);
    updateName();
    name.add_suffix(nameEntry);
    identity.add(name);

    const receiving = new Adw.PreferencesGroup({title: _('Receiving')});
    page.add(receiving);

    const dir = new Adw.ActionRow({
        title: _('Destination folder'),
        subtitle: settings.get_string('receive-directory') || defaultReceiveDir(),
    });
    const dirButton = new Gtk.Button({
        label: _('Choose…'),
        valign: Gtk.Align.CENTER,
    });
    dirButton.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: _('Select Destination')});
        dialog.select_folder(window, null, (_d, res) => {
            try {
                const folder = dialog.select_folder_finish(res);
                const path = folder.get_path();
                if (!path)
                    throw new Error(_('Choose a local destination folder.'));
                settings.set_string('receive-directory', path);
            } catch (e) {
                if (!(e instanceof GLib.Error &&
                    (e.matches(Gtk.DialogError.quark(), Gtk.DialogError.DISMISSED) ||
                    e.matches(Gtk.DialogError.quark(), Gtk.DialogError.CANCELLED))))
                    dir.subtitle = _('Could not select destination: ') + e.message;
            }
        });
    });
    dir.add_suffix(dirButton);
    receiving.add(dir);
    const directoryChangedId = settings.connect('changed::receive-directory', () => {
        dir.subtitle = settings.get_string('receive-directory') || defaultReceiveDir();
    });

    const accept = new Adw.SwitchRow({
        title: _('Accept Automatically'),
        subtitle: _('Accept incoming transfers without asking. Changes apply when receiving is restarted.'),
    });
    settings.bind('accept-automatically', accept, 'active', Gio.SettingsBindFlags.DEFAULT);
    receiving.add(accept);

    const sending = new Adw.PreferencesGroup({title: _('Sending')});
    page.add(sending);

    const receiver = new Adw.ActionRow({
        title: _('Preferred Receiver'),
        subtitle: _('Optional: send only to a device matching this name, service ID or AWDL address. Leave blank to use the first receiver found.'),
    });
    const receiverEntry = new Gtk.Entry({valign: Gtk.Align.CENTER, width_chars: 20, placeholder_text: _('First receiver found')});
    settings.bind('send-receiver', receiverEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
    receiver.add_suffix(receiverEntry);
    sending.add(receiver);

    const timeout = new Adw.SpinRow({
        title: _('Search Time'),
        subtitle: _('Seconds to look for a receiver before giving up.'),
        adjustment: new Gtk.Adjustment({lower: 5, upper: 300, step_increment: 5, page_increment: 30}),
    });
    settings.bind('send-timeout', timeout, 'value', Gio.SettingsBindFlags.DEFAULT);
    sending.add(timeout);

    const ble = new Adw.SwitchRow({
        title: _('Wake Apple Devices'),
        subtitle: _('Send a Bluetooth LE advert so Apple receivers notice the transfer.'),
    });
    settings.bind('send-ble-advert', ble, 'active', Gio.SettingsBindFlags.DEFAULT);
    sending.add(ble);

    const advanced = new Adw.PreferencesGroup({title: _('Advanced')});
    page.add(advanced);

    const iface = new Adw.ComboRow({
        title: _('Transfer Interface'),
        subtitle: _('awdl0 is usually the best choice; it is created when the radio starts. The physical Wi-Fi interface is usually not the transfer interface.'),
    });
    const interfaceModel = new Gtk.StringList();
    iface.model = interfaceModel;
    let interfaceNames = [];
    let updatingInterface = false;
    const refreshInterfaces = () => {
        const selected = settings.get_string('interface') || 'awdl0';
        try {
            interfaceNames = listTransferInterfaces(selected);
            updatingInterface = true;
            interfaceModel.splice(0, interfaceModel.get_n_items(), interfaceNames);
            iface.selected = interfaceNames.indexOf(selected);
            updatingInterface = false;
        } catch (e) {
            interfaceNames = selected === 'awdl0' ? ['awdl0'] : ['awdl0', selected];
            updatingInterface = true;
            interfaceModel.splice(0, interfaceModel.get_n_items(), interfaceNames);
            iface.selected = interfaceNames.indexOf(selected);
            updatingInterface = false;
            iface.subtitle = _('Could not list network interfaces: ') + e.message;
        }
    };
    iface.connect('notify::selected', () => {
        if (!updatingInterface && interfaceNames[iface.selected] !== undefined)
            settings.set_string('interface', interfaceNames[iface.selected]);
    });
    const interfaceChangedId = settings.connect('changed::interface', refreshInterfaces);
    const refreshButton = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        tooltip_text: _('Refresh network interfaces'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    refreshButton.connect('clicked', refreshInterfaces);
    iface.add_suffix(refreshButton);
    refreshInterfaces();
    advanced.add(iface);

    const port = new Adw.SpinRow({
        title: _('Receive Port'),
        subtitle: _('TCP port for incoming transfers. The default is 8771; the firewall must allow it on the transfer interface.'),
        adjustment: new Gtk.Adjustment({lower: 1, upper: 65535, step_increment: 1, page_increment: 100}),
    });
    settings.bind('receive-port', port, 'value', Gio.SettingsBindFlags.DEFAULT);
    advanced.add(port);

    const command = new Adw.ActionRow({
        title: _('Owly Command'),
        subtitle: _('Normally leave this as “owly”. Change it only to use a different installation or executable path.'),
    });
    const commandEntry = new Gtk.Entry({valign: Gtk.Align.CENTER, width_chars: 20});
    settings.bind('owly-command', commandEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
    command.add_suffix(commandEntry);
    advanced.add(command);

    const setup = new Adw.PreferencesGroup({
        title: _('Dependencies'),
        description: _('Owly and its radio service are required. The package installer handles system dependencies and may ask for administrator authentication.'),
    });
    page.add(setup);
    const install = new Adw.ActionRow({
        title: _('Install Owly'),
        subtitle: _('Download the official release and open it in GNOME Software.'),
    });
    const installButton = new Gtk.Button({label: _('Install…'), valign: Gtk.Align.CENTER});
    const instructionsButton = new Gtk.Button({
        label: _('Instructions'), valign: Gtk.Align.CENTER,
        tooltip_text: _('Open official installation instructions'),
    });
    instructionsButton.connect('clicked', () => {
        try {
            Gio.AppInfo.launch_default_for_uri(RELEASES_URL, null);
        } catch (e) {
            install.subtitle = _('Could not open installation instructions: ') + e.message;
        }
    });
    const cancellable = new Gio.Cancellable();
    window.connect('close-request', () => {
        cancellable.cancel();
        settings.disconnect(nameChangedId);
        settings.disconnect(directoryChangedId);
        settings.disconnect(interfaceChangedId);
        return false;
    });
    installButton.connect('clicked', async () => {
        installButton.sensitive = false;
        try {
            const path = await prepareOwlyInstaller(cancellable, phase => {
                install.subtitle = phase === 'release' ? _('Checking the latest official release…') :
                    _('Downloading and verifying the package…');
            });
            if (cancellable.is_cancelled())
                return;
            const process = openOwlyInstaller(path);
            process.wait_async(null, (p, result) => {
                try {
                    p.wait_finish(result);
                    if (!cancellable.is_cancelled() && !p.get_successful())
                        install.subtitle = _('GNOME Software could not open the package. Use the official installation instructions.');
                } catch (e) {
                    if (!cancellable.is_cancelled())
                        install.subtitle = _('Could not open the package: ') + e.message;
                }
            });
            install.subtitle = _('Package opened in GNOME Software. Review and confirm installation there.');
        } catch (e) {
            if (!cancellable.is_cancelled())
                install.subtitle = _('Installation could not be started: ') + e.message;
        } finally {
            if (!cancellable.is_cancelled())
                installButton.sensitive = true;
        }
    });
    install.add_suffix(instructionsButton);
    install.add_suffix(installButton);
    setup.add(install);

    return page;
}

export default class AirGnomePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(560, 720);
        window.add(buildSettingsPages(this.getSettings(), window));
    }
}
