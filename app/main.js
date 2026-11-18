#!/usr/bin/env -S gjs -m
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import {programArgs} from 'system';

import {
    formatBytes, loadSettings, receiveCommand, receiveDir, sendCommand, spawnWithLines, stopProcess,
} from '../common.js';
import {parseSendProgress, sendErrorMessage} from './sendProgress.js';
import {parseReceiveOffer} from './receiveOutput.js';

const extensionDir = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

const _ = s => s;

// ---------------------------------------------------------------------------
// A button whose own background doubles as a progress bar
// ---------------------------------------------------------------------------

let buttonCounter = 0;
const progressProvider = new Gtk.CssProvider();
const progressRules = new Map();
let providerInstalled = false;

function setProgressRule(className, css) {
    if (!providerInstalled) {
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
            progressProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        providerInstalled = true;
    }
    if (css === null)
        progressRules.delete(className);
    else
        progressRules.set(className, css);
    progressProvider.load_from_string([...progressRules.values()].join('\n'));
}

const TransferButton = GObject.registerClass(
class TransferButton extends Gtk.Button {
    constructor(label) {
        super({
            label,
            halign: Gtk.Align.CENTER,
            css_classes: ['pill', 'suggested-action'],
        });
        this._idleLabel = label;
        this._className = `transfer-button-${buttonCounter++}`;
        this._pulseId = 0;
        this.add_css_class(this._className);
    }

    // fraction: 0..1 for determinate progress, null for indeterminate
    start(fraction = null) {
        this.remove_css_class('suggested-action');
        this.set_sensitive(false);
        this.set_label(_('Transferring…'));
        this._stopPulse();
        if (fraction === null)
            this._startPulse();
        else
            this.setFraction(fraction);
    }

    setFraction(fraction) {
        this._stopPulse();
        this._paint(Math.max(0, Math.min(1, fraction)) * 100);
        this.set_label(`${_('Transferring…')} ${Math.round(fraction * 100)}%`);
    }

    stopping() {
        this._stopPulse();
        setProgressRule(this._className, null);
        this.set_label(_('Stopping…'));
    }

    finish() {
        this._stopPulse();
        setProgressRule(this._className, null);
        this.add_css_class('suggested-action');
        this.set_label(this._idleLabel);
    }

    _paint(percent, from = 0) {
        // The unfilled part keeps a faint accent tint so the button still reads as a button
        setProgressRule(this._className, `
            button.${this._className}.pill {
                color: @window_fg_color;
                background-color: alpha(@accent_bg_color, 0.18);
                background-image: linear-gradient(to right,
                    transparent ${from}%,
                    alpha(@accent_bg_color, 0.65) ${from}%,
                    alpha(@accent_bg_color, 0.65) ${percent}%,
                    transparent ${percent}%);
            }`);
    }

    _startPulse() {
        let position = 0;
        this._stopPulse();
        this._pulseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            position = (position + 1.5) % 130;
            this._paint(Math.min(position, 100), Math.max(position - 30, 0));
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPulse() {
        if (this._pulseId) {
            GLib.source_remove(this._pulseId);
            this._pulseId = 0;
        }
    }

    vfunc_unrealize() {
        this._stopPulse();
        super.vfunc_unrealize();
    }
});

// ---------------------------------------------------------------------------
// Shared window pieces
// ---------------------------------------------------------------------------

function radioBanner(settings) {
    const banner = new Adw.Banner({button_label: _('Turn On')});
    const update = () => {
        const state = settings.get_string('radio-state');
        banner.revealed = state !== 'up';
        if (state === 'starting') {
            banner.title = _('Starting the radio…');
            banner.button_label = null;
        } else {
            banner.title = _('The radio is off');
            banner.button_label = _('Turn On');
        }
    };
    banner.connect('button-clicked', () => settings.set_boolean('radio-enabled', true));
    const changedId = settings.connect('changed::radio-state', update);
    update();
    return {banner, changedId};
}

function buildWindow(app, title, banner, content, bottom = null) {
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    toolbar.add_top_bar(banner);

    const clamp = new Adw.Clamp({
        maximum_size: 520,
        tightening_threshold: 400,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 12,
        margin_end: 12,
        child: content,
    });
    toolbar.set_content(new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        child: clamp,
    }));
    if (bottom)
        toolbar.add_bottom_bar(bottom);

    const overlay = new Adw.ToastOverlay({child: toolbar});
    const window = new Adw.ApplicationWindow({
        application: app,
        title,
        content: overlay,
        default_width: 480,
        default_height: 560,
    });
    return {window, overlay};
}

function contentBox() {
    return new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24});
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const ABORT_AFTER_SECONDS = 60;
const SEND_STALL_SECONDS = 60;

function presentSend(app, settings) {
    let files = [];
    let proc = null;
    let session = 0;
    let abortTimer = 0;
    let finishTimer = 0;
    let forceTimer = 0;
    let stallTimer = 0;
    let cancelling = false;
    let stopError = null;

    const content = contentBox();

    const pickGroup = new Adw.PreferencesGroup();
    const pickRow = new Adw.ActionRow({
        title: _('Files'),
        subtitle: _('Choose the files to send'),
    });
    pickRow.add_prefix(new Gtk.Image({icon_name: 'document-send-symbolic'}));
    const browse = new Gtk.Button({label: _('Browse'), valign: Gtk.Align.CENTER});
    pickRow.add_suffix(browse);
    pickRow.set_activatable_widget(browse);
    pickGroup.add(pickRow);
    content.append(pickGroup);

    const listGroup = new Adw.PreferencesGroup({title: _('Selected Files')});
    const placeholder = new Adw.ActionRow({title: _('No files selected'), sensitive: false});
    listGroup.add(placeholder);
    content.append(listGroup);

    const actions = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        margin_top: 12,
        margin_bottom: 24,
        margin_start: 12,
        margin_end: 12,
    });
    const start = new TransferButton(_('Start transfer'));
    start.set_sensitive(false);
    actions.append(start);

    const status = new Gtk.Label({
        css_classes: ['dim-label'],
        wrap: true,
        justify: Gtk.Justification.CENTER,
        visible: false,
    });
    actions.append(status);

    const abort = new Gtk.Button({
        label: _('Abort'),
        halign: Gtk.Align.CENTER,
        css_classes: ['pill', 'destructive-action'],
        visible: false,
    });
    actions.append(abort);

    const {banner, changedId: bannerChangedId} = radioBanner(settings);
    const {window, overlay} = buildWindow(app, _('Send'), banner, content, actions);

    let rows = [];
    const refresh = () => {
        const busy = proc !== null || finishTimer !== 0;
        for (const row of rows)
            listGroup.remove(row);
        rows = [];
        placeholder.visible = files.length === 0;
        for (const file of files) {
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(file.get_basename(), -1),
                subtitle: GLib.markup_escape_text(file.get_parent()?.get_path() ?? '', -1),
            });
            row.add_prefix(new Gtk.Image({icon_name: 'text-x-generic-symbolic'}));
            const remove = new Gtk.Button({
                icon_name: 'window-close-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular'],
                tooltip_text: _('Remove'),
                sensitive: !busy,
            });
            remove.connect('clicked', () => {
                files = files.filter(f => f !== file);
                refresh();
            });
            row.add_suffix(remove);
            listGroup.add(row);
            rows.push(row);
        }
        browse.sensitive = !busy;
        if (!busy)
            start.set_sensitive(files.length > 0 && settings.get_string('radio-state') === 'up');
    };
    const radioChangedId = settings.connect('changed::radio-state', refresh);

    const clearTimers = () => {
        if (abortTimer) {
            GLib.source_remove(abortTimer);
            abortTimer = 0;
        }
        if (finishTimer) {
            GLib.source_remove(finishTimer);
            finishTimer = 0;
        }
        if (forceTimer) {
            GLib.source_remove(forceTimer);
            forceTimer = 0;
        }
        if (stallTimer) {
            GLib.source_remove(stallTimer);
            stallTimer = 0;
        }
    };

    // Puts the window back in its idle state; `session` guards against late callbacks
    const reset = (errorMessage = null) => {
        clearTimers();
        session++;
        proc = null;
        cancelling = false;
        stopError = null;
        start.finish();
        status.label = errorMessage ?? '';
        status.visible = errorMessage !== null;
        if (errorMessage)
            status.add_css_class('error');
        else
            status.remove_css_class('error');
        abort.visible = false;
        abort.sensitive = true;
        refresh();
    };

    const addFiles = newFiles => {
        if (proc || finishTimer)
            return;
        let unsupported = false;
        for (const file of newFiles) {
            if (!file.get_path())
                unsupported = true;
            else if (!files.some(f => f.equal(file)))
                files.push(file);
        }
        if (unsupported)
            overlay.add_toast(new Adw.Toast({title: _('Only local files can be sent.')}));
        refresh();
    };

    browse.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: _('Select Files to Send')});
        dialog.open_multiple(window, null, (_d, res) => {
            try {
                const model = dialog.open_multiple_finish(res);
                const picked = [];
                for (let i = 0; i < model.get_n_items(); i++)
                    picked.push(model.get_item(i));
                addFiles(picked);
            } catch (e) {
                if (!(e instanceof GLib.Error &&
                    (e.matches(Gtk.DialogError.quark(), Gtk.DialogError.DISMISSED) ||
                    e.matches(Gtk.DialogError.quark(), Gtk.DialogError.CANCELLED))))
                    overlay.add_toast(new Adw.Toast({title: _('Could not select files: ') + e.message}));
            }
        });
    });

    const drop = Gtk.DropTarget.new(Gdk.FileList.$gtype, Gdk.DragAction.COPY);
    drop.connect('drop', (_t, value) => {
        if (proc || finishTimer)
            return false;
        addFiles(value.get_files());
        return true;
    });
    window.add_controller(drop);

    const stopTransfer = (errorMessage = null) => {
        if (!proc || cancelling)
            return;
        cancelling = true;
        stopError = errorMessage;
        if (abortTimer) {
            GLib.source_remove(abortTimer);
            abortTimer = 0;
        }
        if (stallTimer) {
            GLib.source_remove(stallTimer);
            stallTimer = 0;
        }
        abort.sensitive = false;
        start.stopping();
        status.label = _('Stopping transfer…');
        proc.send_signal(2);
        forceTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            forceTimer = 0;
            if (proc)
                proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
    };

    abort.connect('clicked', () => stopTransfer());

    start.connect('clicked', () => {
        const mine = ++session;
        let lastLine = '';
        let lastError = '';
        let progress = -1;
        const names = files.map(f => f.get_path());

        const watchProgress = () => {
            if (stallTimer)
                GLib.source_remove(stallTimer);
            stallTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEND_STALL_SECONDS * 1000, () => {
                stallTimer = 0;
                stopTransfer(_('Error: Transfer stalled. The receiver may have disconnected.'));
                return GLib.SOURCE_REMOVE;
            });
        };

        start.start(null);
        status.remove_css_class('error');
        status.label = _('Looking for a receiver…');
        status.visible = true;
        abort.visible = false;
        abortTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ABORT_AFTER_SECONDS * 1000, () => {
            abortTimer = 0;
            abort.visible = true;
            return GLib.SOURCE_REMOVE;
        });

        try {
            proc = spawnWithLines(sendCommand(settings, names), line => {
                if (mine !== session)
                    return;
                lastLine = line;
                const error = /(?:^|bytes)(owly:|failed:|error:)(.*)$/i.exec(line);
                if (error)
                    lastError = error[1] + error[2];
                if (cancelling)
                    return;
                if (error) {
                    stopTransfer(sendErrorMessage(lastError));
                    return;
                }
                const fraction = parseSendProgress(line);
                if (fraction !== null) {
                    start.setFraction(fraction);
                    status.label = _('Sending…');
                    if (fraction > progress) {
                        progress = fraction;
                        watchProgress();
                    }
                } else if (/^sending to\b/i.test(line)) {
                    status.label = _('Waiting for the receiver…');
                } else if (line === 'accepted') {
                    status.label = _('Sending…');
                    watchProgress();
                }
            }, exitStatus => {
                if (mine !== session)
                    return;
                const wasCancelled = cancelling;
                const cancellationError = stopError;
                const ok = exitStatus === 0;
                proc = null;
                clearTimers();
                abort.visible = false;
                if (wasCancelled) {
                    reset(cancellationError);
                    if (!cancellationError)
                        overlay.add_toast(new Adw.Toast({title: _('Transfer aborted')}));
                } else if (ok) {
                    start.setFraction(1);
                    status.label = _('Transfer complete');
                    files = [];
                    overlay.add_toast(new Adw.Toast({title: _('Transfer complete')}));
                    finishTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                        finishTimer = 0;
                        reset();
                        return GLib.SOURCE_REMOVE;
                    });
                    refresh();
                } else {
                    reset(sendErrorMessage(lastError || lastLine));
                }
            }, {drainOutputBeforeExit: true});
        } catch (e) {
            reset(sendErrorMessage(e.message));
            return;
        }
        refresh();
    });

    window.connect('close-request', () => {
        session++;
        settings.disconnect(bannerChangedId);
        settings.disconnect(radioChangedId);
        if (proc) {
            proc.force_exit();
            proc = null;
        }
        clearTimers();
        return false;
    });

    refresh();
    window.present();
}

// ---------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------

function presentReceive(app, settings) {
    let proc = null;
    let wanted = false;
    let ready = false;
    let collecting = false;
    let promptDialog = null;
    let promptTimer = 0;
    let sender = '';
    let saved = 0;
    let receiveError = '';
    let lastLine = '';
    let lastError = '';
    let transfers = [];

    const content = contentBox();

    const destGroup = new Adw.PreferencesGroup();
    const destRow = new Adw.ActionRow({title: _('Destination')});
    destRow.add_prefix(new Gtk.Image({icon_name: 'folder-download-symbolic'}));
    const destButton = new Gtk.Button({label: _('Select Destination'), valign: Gtk.Align.CENTER});
    destRow.add_suffix(destButton);
    destRow.set_activatable_widget(destButton);
    destGroup.add(destRow);
    content.append(destGroup);

    const enableBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
    });
    const enable = new Gtk.Button({
        label: _('Enable Receive'),
        halign: Gtk.Align.CENTER,
        css_classes: ['pill', 'suggested-action'],
    });
    const comment = new Gtk.Label({css_classes: ['dim-label'], wrap: true, justify: Gtk.Justification.CENTER});
    enableBox.append(enable);
    enableBox.append(comment);
    content.append(enableBox);

    const listGroup = new Adw.PreferencesGroup({title: _('Transfers'), visible: false});
    const doneRow = new Adw.ActionRow({title: _('All files transmitted successfully'), visible: false});
    doneRow.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic', css_classes: ['success']}));
    listGroup.add(doneRow);
    content.append(listGroup);

    const {banner, changedId: bannerChangedId} = radioBanner(settings);
    const {window, overlay} = buildWindow(app, _('Receive'), banner, content);
    const refreshDest = () => {
        destRow.subtitle = GLib.markup_escape_text(receiveDir(settings), -1);
    };

    const refreshState = () => {
        const radioUp = settings.get_string('radio-state') === 'up';
        enable.label = wanted ? _('Disable Receive') : _('Enable Receive');
        destButton.sensitive = !wanted;
        if (wanted) {
            enable.remove_css_class('suggested-action');
            if (receiveError)
                comment.add_css_class('error');
            else
                comment.remove_css_class('error');
            comment.label = receiveError || (ready && radioUp ? _('Ready to receive files') :
                radioUp ? _('Starting receiver…') : _('Waiting for the radio…'));
        } else {
            enable.add_css_class('suggested-action');
            comment.label = receiveError;
            if (receiveError)
                comment.add_css_class('error');
            else
                comment.remove_css_class('error');
        }
        comment.visible = comment.label !== '';
    };

    const clearTransfers = () => {
        for (const transfer of transfers)
            listGroup.remove(transfer.row);
        transfers = [];
        saved = 0;
        doneRow.visible = false;
        listGroup.visible = false;
    };

    const addTransfer = ({name, size}) => {
        const bar = new Gtk.ProgressBar({valign: Gtk.Align.CENTER, width_request: 140});
        const row = new Adw.ActionRow({title: GLib.markup_escape_text(name, -1)});
        row.add_prefix(new Gtk.Image({icon_name: 'text-x-generic-symbolic'}));
        row.add_suffix(bar);
        if (size !== null)
            row.subtitle = formatBytes(size);
        listGroup.add(row);
        transfers.push({name, row, bar});
        listGroup.visible = true;
    };

    const dismissPrompt = () => {
        if (promptTimer) {
            GLib.source_remove(promptTimer);
            promptTimer = 0;
        }
        if (promptDialog) {
            const dialog = promptDialog;
            promptDialog = null;
            dialog.close();
        }
    };

    const answerPrompt = accept => {
        if (!proc || !promptDialog)
            return;
        dismissPrompt();
        try {
            proc.get_stdin_pipe().write_all(new TextEncoder().encode(accept ? 'y\n' : 'n\n'), null);
            if (!accept)
                clearTransfers();
        } catch (e) {
            receiveError = _('Could not answer the transfer request: ') + e.message;
            overlay.add_toast(new Adw.Toast({title: receiveError}));
            clearTransfers();
        }
    };

    const showPrompt = () => {
        collecting = false;
        const names = transfers.map(item => item.name).join('\n');
        const dialog = new Adw.MessageDialog({
            transient_for: window,
            heading: _('Incoming transfer'),
            body: sender + (names ? `\n\n${names}` : '') +
                `\n\n${_('Respond within 15 seconds.')}`,
        });
        dialog.add_response('decline', _('Decline'));
        dialog.add_response('accept', _('Accept'));
        dialog.set_response_appearance('accept', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('decline');
        dialog.set_close_response('decline');
        promptDialog = dialog;
        dialog.connect('response', (_dialog, response) => answerPrompt(response === 'accept'));
        dialog.present();
        promptTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 14000, () => {
            promptTimer = 0;
            answerPrompt(false);
            overlay.add_toast(new Adw.Toast({title: _('Transfer request timed out')}));
            return GLib.SOURCE_REMOVE;
        });
    };

    const onLine = line => {
        lastLine = line;
        if (/^(owly:|error:|transfer failed:)/i.test(line))
            lastError = line;
        const offer = collecting ? parseReceiveOffer(line) : null;
        if (/^receiving as /.test(line)) {
            ready = true;
            refreshState();
        } else if (line.endsWith(' wants to send:')) {
            dismissPrompt();
            clearTransfers();
            receiveError = '';
            refreshState();
            sender = line;
            collecting = true;
        } else if (offer) {
            addTransfer(offer);
        } else if (/^transfer failed:|^the request was withdrawn|^timed out$/i.test(line)) {
            collecting = false;
            dismissPrompt();
            clearTransfers();
            receiveError = line;
            refreshState();
            overlay.add_toast(new Adw.Toast({title: line}));
        } else if (GLib.path_is_absolute(line) &&
            Gio.File.new_for_path(line).get_parent()?.equal(Gio.File.new_for_path(receiveDir(settings)))) {
            collecting = false;
            if (transfers.length > 0) {
                const transfer = transfers.shift();
                listGroup.remove(transfer.row);
                saved++;
                if (!transfers.length && saved) {
                    doneRow.visible = true;
                    listGroup.visible = true;
                }
            }
        }
    };

    const poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        for (const transfer of transfers)
            transfer.bar.pulse();
        return GLib.SOURCE_CONTINUE;
    });

    const stopReceive = () => {
        const old = proc;
        proc = null;
        ready = false;
        dismissPrompt();
        clearTransfers();
        stopProcess(old, 2);
    };

    const reconcile = () => {
        const radioUp = settings.get_string('radio-state') === 'up';
        if (wanted && radioUp && !proc) {
            const dir = receiveDir(settings);
            try {
                if (GLib.mkdir_with_parents(dir, 0o755) !== 0)
                    throw new Error(_('Could not create destination folder: ') + dir);
                lastLine = '';
                lastError = '';
                const argv = receiveCommand(settings, dir);
                const started = spawnWithLines(argv, line => {
                    if (proc === started)
                        onLine(line);
                }, status => {
                    if (proc === started) {
                        proc = null;
                        wanted = false;
                        ready = false;
                        dismissPrompt();
                        clearTransfers();
                        receiveError = status === 0 ? _('Receiver stopped unexpectedly') :
                            lastError || lastLine || _('Receiver failed to start');
                        refreshState();
                    }
                }, {
                    prompt: 'accept? [y/N] ',
                    onPrompt: () => {
                        if (proc === started)
                            showPrompt();
                    },
                    drainOutputBeforeExit: true,
                });
                proc = started;
            } catch (e) {
                wanted = false;
                ready = false;
                receiveError = e.message;
            }
        } else if ((!wanted || !radioUp) && proc) {
            stopReceive();
        }
        refreshState();
    };

    enable.connect('clicked', () => {
        wanted = !wanted;
        if (wanted) {
            receiveError = '';
            clearTransfers();
            if (!settings.get_boolean('radio-enabled'))
                settings.set_boolean('radio-enabled', true);
        }
        reconcile();
    });

    destButton.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: _('Select Destination'),
            initial_folder: Gio.File.new_for_path(receiveDir(settings)),
        });
        dialog.select_folder(window, null, (_d, res) => {
            try {
                const path = dialog.select_folder_finish(res).get_path();
                if (!path)
                    throw new Error(_('Choose a local destination folder.'));
                settings.set_string('receive-directory', path);
            } catch (e) {
                if (!(e instanceof GLib.Error &&
                    (e.matches(Gtk.DialogError.quark(), Gtk.DialogError.DISMISSED) ||
                    e.matches(Gtk.DialogError.quark(), Gtk.DialogError.CANCELLED))))
                    overlay.add_toast(new Adw.Toast({title: _('Could not select destination: ') + e.message}));
                return;
            }
            refreshDest();
        });
    });

    const radioStateId = settings.connect('changed::radio-state', reconcile);
    const radioEnabledId = settings.connect('changed::radio-enabled', () => {
        if (wanted && !settings.get_boolean('radio-enabled')) {
            wanted = false;
            stopReceive();
            receiveError = _('The radio is off. Turn it on and try again.');
            refreshState();
        }
    });

    window.connect('close-request', () => {
        wanted = false;
        stopReceive();
        settings.disconnect(bannerChangedId);
        settings.disconnect(radioStateId);
        settings.disconnect(radioEnabledId);
        GLib.source_remove(poll);
        return false;
    });

    refreshDest();
    reconcile();
    window.present();
}

// ---------------------------------------------------------------------------

const kind = programArgs[0] === 'receive' ? 'receive' : 'send';
const settings = loadSettings(extensionDir);

GLib.set_application_name('AirGnomeUI');
const app = new Adw.Application({
    application_id: `io.github.maze404.AirDrop.${kind === 'send' ? 'Send' : 'Receive'}`,
    flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
app.connect('activate', () => {
    const existing = app.get_active_window();
    if (existing)
        existing.present();
    else if (kind === 'send')
        presentSend(app, settings);
    else
        presentReceive(app, settings);
});
app.run([]);
