// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function listTransferInterfaces(current) {
    const sysfs = '/sys/class/net';
    const names = new Set(['awdl0']);
    if (current)
        names.add(current);
    const folder = Gio.File.new_for_path(sysfs);
    const enumerator = folder.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (Gio.File.new_for_path(GLib.build_filenamev([sysfs, name, 'phy80211'])).query_exists(null) ||
                Gio.File.new_for_path(GLib.build_filenamev([sysfs, name, 'wireless'])).query_exists(null))
                names.add(name);
        }
    } finally {
        enumerator.close(null);
    }
    return ['awdl0', ...[...names].filter(name => name !== 'awdl0').sort()];
}
