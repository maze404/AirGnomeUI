// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SCHEMA_ID = 'org.gnome.shell.extensions.airdrop';

export function loadSettings(extensionDir) {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([extensionDir, 'schemas']),
        Gio.SettingsSchemaSource.get_default(),
        false);
    return new Gio.Settings({settings_schema: source.lookup(SCHEMA_ID, true)});
}

export function defaultReceiveDir() {
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
}

export function receiveDir(settings) {
    return settings.get_string('receive-directory') || defaultReceiveDir();
}

function commonArgs(settings) {
    const args = ['--iface', settings.get_string('interface') || 'awdl0'];
    const name = settings.get_string('device-name');
    if (name)
        args.push('--name', name);
    return args;
}

export function radioCommand(settings) {
    return [settings.get_string('owly-command') || 'owly', 'radio', 'up'];
}

export function sendCommand(settings, paths) {
    const argv = [settings.get_string('owly-command') || 'owly', 'send', ...commonArgs(settings)];
    const receiver = settings.get_string('send-receiver');
    if (receiver)
        argv.push('--to', receiver);
    argv.push('--seconds', String(settings.get_int('send-timeout')));
    if (!settings.get_boolean('send-ble-advert'))
        argv.push('--no-ble');
    argv.push(...paths);
    return argv;
}

export function receiveCommand(settings, dir) {
    const argv = [settings.get_string('owly-command') || 'owly', 'receive', ...commonArgs(settings),
        '--dir', dir, '--port', String(settings.get_int('receive-port'))];
    if (settings.get_boolean('accept-automatically'))
        argv.push('--accept');
    return argv;
}

// Spawns argv with stdout and stderr merged; onLine gets each line, including
// carriage-return separated progress updates.
export function spawnWithLines(argv, onLine, onExit, {
    drainOutputBeforeExit = false, prompt = null, onPrompt = null,
} = {}) {
    let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE;
    if (prompt)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;
    const proc = Gio.Subprocess.new(argv, flags);
    const stream = new Gio.DataInputStream({
        base_stream: proc.get_stdout_pipe(),
        newline_type: Gio.DataStreamNewlineType.ANY,
    });
    const cancellable = new Gio.Cancellable();
    let outputDone = false;
    let exitStatus = null;
    let drainTimer = 0;
    let exitReported = false;
    const reportExit = () => {
        if (exitReported || exitStatus === null || (drainOutputBeforeExit && !outputDone))
            return;
        exitReported = true;
        if (drainTimer) {
            GLib.source_remove(drainTimer);
            drainTimer = 0;
        }
        onExit?.(exitStatus);
    };
    const readNextLine = () => {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, res) => {
            let line = null;
            try {
                [line] = stream.read_line_finish_utf8(res);
            } catch (e) {
                if (!cancellable.is_cancelled())
                    logError(e, 'Failed to read owly output');
            }
            if (line === null) {
                outputDone = true;
                reportExit();
                return;
            }
            if (line.trim())
                onLine(line.trim());
            readNextLine();
        });
    };
    const decoder = new TextDecoder();
    let buffer = [];
    const promptBytes = prompt ? Array.from(new TextEncoder().encode(prompt)) : [];
    const handleChunk = bytes => {
        buffer.push(...bytes);
        while (buffer.length) {
            const newline = buffer.findIndex(byte => byte === 10 || byte === 13);
            const promptIndex = prompt ? buffer.findIndex((byte, index) =>
                byte === promptBytes[0] &&
                promptBytes.every((value, offset) => buffer[index + offset] === value)) : -1;
            if (promptIndex >= 0 && (newline < 0 || promptIndex < newline)) {
                const line = decoder.decode(Uint8Array.from(buffer.slice(0, promptIndex))).trim();
                if (line)
                    onLine(line);
                buffer = buffer.slice(promptIndex + promptBytes.length);
                onPrompt?.();
            } else if (newline >= 0) {
                const line = decoder.decode(Uint8Array.from(buffer.slice(0, newline))).trim();
                buffer = buffer.slice(newline + 1);
                if (line)
                    onLine(line);
            } else {
                break;
            }
        }
    };
    const readNextChunk = () => {
        stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable, (_s, res) => {
            try {
                const bytes = stream.read_bytes_finish(res).get_data();
                if (bytes.length) {
                    handleChunk(bytes);
                    readNextChunk();
                    return;
                }
                const line = decoder.decode(Uint8Array.from(buffer)).trim();
                if (line)
                    onLine(line);
            } catch (e) {
                if (!cancellable.is_cancelled())
                    logError(e, 'Failed to read owly output');
            }
            outputDone = true;
            reportExit();
        });
    };
    if (prompt)
        readNextChunk();
    else
        readNextLine();
    proc.wait_async(null, (_p, res) => {
        try {
            proc.wait_finish(res);
        } catch (e) {
            logError(e, 'Failed to wait for owly');
            exitStatus = -1;
            outputDone = true;
            cancellable.cancel();
            reportExit();
            return;
        }
        exitStatus = proc.get_if_exited() ? proc.get_exit_status() : -1;
        if (drainOutputBeforeExit && !outputDone) {
            // A child process may inherit the pipe after owly exits.
            drainTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                drainTimer = 0;
                cancellable.cancel();
                outputDone = true;
                reportExit();
                return GLib.SOURCE_REMOVE;
            });
        }
        reportExit();
    });
    return proc;
}

export function stopProcess(proc, forceAfterSeconds = 5) {
    if (!proc)
        return;
    proc.send_signal(2); // SIGINT, same as Ctrl-C
    let forceTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, forceAfterSeconds, () => {
        forceTimer = 0;
        if (proc.get_identifier() !== null)
            proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    proc.wait_async(null, (process, result) => {
        process.wait_finish(result);
        if (forceTimer) {
            GLib.source_remove(forceTimer);
            forceTimer = 0;
        }
    });
}

export function formatBytes(n) {
    const units = ['B', 'kB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) {
        n /= 1000;
        i++;
    }
    return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}
