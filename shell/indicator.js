// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {radioCommand, spawnWithLines, stopProcess} from '../common.js';

// Owns the `owly radio up` process, which holds the radio until interrupted.
export class RadioController {
    constructor(settings) {
        this._settings = settings;
        this._proc = null;
        this._subscription = null;
        this._lastLine = '';
        this._changedId = settings.connect('changed::radio-enabled', () => this._sync());
        this._sync();
    }

    _sync() {
        const wanted = this._settings.get_boolean('radio-enabled');
        if (wanted && !this._proc)
            this._start();
        else if (!wanted && this._proc)
            this._stop();
        else if (!wanted)
            this._settings.set_string('radio-state', 'off');
    }

    _start() {
        this._settings.set_string('radio-state', 'starting');
        this._lastLine = '';
        try {
            const subscription = {controller: this};
            const proc = spawnWithLines(radioCommand(this._settings), line => {
                const controller = subscription.controller;
                if (!controller || controller._proc !== proc)
                    return;
                controller._lastLine = line;
                if (/\bis up\b/.test(line))
                    controller._settings.set_string('radio-state', 'up');
            }, status => {
                if (subscription.controller)
                    subscription.controller._onExit(proc, status);
            });
            this._proc = proc;
            this._subscription = subscription;
        } catch (e) {
            this._fail(e.message);
        }
    }

    _stop() {
        const proc = this._proc;
        this._proc = null;
        this._subscription.controller = null;
        this._subscription = null;
        this._settings.set_string('radio-state', 'off');
        stopProcess(proc);
    }

    _onExit(proc, status) {
        if (this._proc !== proc)
            return;
        this._proc = null;
        this._subscription.controller = null;
        this._subscription = null;
        if (this._settings.get_boolean('radio-enabled') && status !== 0)
            this._fail(this._lastLine);
        else
            this._settings.set_boolean('radio-enabled', false);
        this._settings.set_string('radio-state', 'off');
    }

    _fail(message) {
        this._settings.set_boolean('radio-enabled', false);
        this._settings.set_string('radio-state', 'off');
        Main.notifyError(_('AirGnomeUI radio failed to start'), message || _('owly exited unexpectedly.'));
    }

    destroy() {
        this._settings.disconnect(this._changedId);
        if (this._proc)
            this._stop();
        this._settings.set_boolean('radio-enabled', false);
        this._settings.set_string('radio-state', 'off');
    }
}

const AirGnomeToggle = GObject.registerClass(
class AirGnomeToggle extends QuickSettings.QuickMenuToggle {
    constructor(extension, settings) {
        super({
            title: _('AirGnomeUI'),
            iconName: 'network-wireless-symbolic',
            toggleMode: true,
        });
        this._settings = settings;

        this.menu.setHeader('network-wireless-symbolic', _('AirGnomeUI'));

        const section = new PopupMenu.PopupMenuSection();
        for (const [title, icon, action] of [
            [_('Send'), 'document-send-symbolic', () => extension.openWindow('send')],
            [_('Receive'), 'folder-download-symbolic', () => extension.openWindow('receive')],
            [_('Settings'), 'preferences-system-symbolic', () => extension.openPreferences()],
        ]) {
            const item = new PopupMenu.PopupImageMenuItem(title, icon);
            item.connect('activate', () => {
                this.menu.close();
                Main.overview.hide();
                action();
            });
            section.addMenuItem(item);
        }
        this.menu.addMenuItem(section);

        settings.bind('radio-enabled', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
        this._stateId = settings.connect('changed::radio-state', () => this._updateState());
        this._updateState();
    }

    _updateState() {
        const state = this._settings.get_string('radio-state');
        this.subtitle = state === 'up' ? _('On') : state === 'starting' ? _('Starting…') : null;
    }

    destroy() {
        this._settings.disconnect(this._stateId);
        Gio.Settings.unbind(this, 'checked');
        super.destroy();
    }
});

export const AirGnomeIndicator = GObject.registerClass(
class AirGnomeIndicator extends QuickSettings.SystemIndicator {
    constructor(extension, settings) {
        super();
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'network-wireless-symbolic';
        this.quickSettingsItems.push(new AirGnomeToggle(extension, settings));

        this._settings = settings;
        this._stateId = settings.connect('changed::radio-state', () => this._update());
        this._update();
    }

    _update() {
        this._indicator.visible = this._settings.get_string('radio-state') === 'up';
    }

    destroy() {
        this._settings.disconnect(this._stateId);
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});
