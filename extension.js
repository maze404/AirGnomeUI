// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AirGnomeIndicator, RadioController} from './shell/indicator.js';

export default class AirGnomeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._radio = new RadioController(this._settings);
        this._indicator = new AirGnomeIndicator(this, this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._radio.destroy();
        this._radio = null;
        this._settings = null;
    }

    openWindow(kind) {
        try {
            const script = GLib.build_filenamev([this.path, 'app', 'main.js']);
            Gio.Subprocess.new(['gjs', '-m', script, kind], Gio.SubprocessFlags.NONE);
        } catch (e) {
            Main.notifyError(_('Could not open the AirGnomeUI window'), e.message);
        }
    }
}
