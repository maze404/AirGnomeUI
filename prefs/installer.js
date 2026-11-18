// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const API_URL = 'https://api.github.com/repos/t4t5/owly/releases/latest';
const RELEASES_URL = 'https://github.com/t4t5/owly#install';
const MAX_PACKAGE_SIZE = 32 * 1024 * 1024;

export function selectOwlyAsset(release, osId, osLike, architecture) {
    const systems = `${osId ?? ''} ${osLike ?? ''}`.toLowerCase().split(/\s+/);
    let pattern;
    if (systems.some(id => ['debian', 'ubuntu'].includes(id)) && architecture === 'x86_64')
        pattern = /^owly_[0-9][A-Za-z0-9.+~:-]*_amd64\.deb$/;
    else if (systems.some(id => ['fedora', 'rhel'].includes(id)) && architecture === 'x86_64')
        pattern = /^owly-[0-9][A-Za-z0-9.+~_-]*\.x86_64\.rpm$/;
    else
        throw new Error('No supported automatic installer is available for this distribution or architecture. Use the official installation instructions.');

    const matches = (release.assets ?? []).filter(asset =>
        pattern.test(asset.name ?? '') &&
        /^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '') &&
        Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_PACKAGE_SIZE &&
        (asset.browser_download_url ?? '').startsWith('https://github.com/t4t5/owly/releases/download/'));
    if (matches.length !== 1)
        throw new Error('The latest release has no unique supported package with a SHA-256 digest. Use the official installation instructions.');
    return matches[0];
}

function fetch(session, url, cancellable) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'AirGnomeUI-GNOME-Extension');
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            try {
                const bytes = s.send_and_read_finish(result);
                if (message.status_code !== Soup.Status.OK)
                    throw new Error(`Download failed (HTTP ${message.status_code})`);
                resolve(bytes.get_data());
            } catch (e) {
                reject(e);
            }
        });
    });
}

export async function prepareOwlyInstaller(cancellable, onProgress = () => {}) {
    if (!GLib.find_program_in_path('gnome-software'))
        throw new Error('GNOME Software is not installed. Use the official installation instructions.');
    const arch = Gio.Subprocess.new(['uname', '-m'], Gio.SubprocessFlags.STDOUT_PIPE);
    const [, architecture] = arch.communicate_utf8(null, null);
    if (!arch.get_successful())
        throw new Error('Could not determine system architecture.');

    const session = new Soup.Session({timeout: 30});
    onProgress('release');
    const metadata = await fetch(session, API_URL, cancellable);
    const release = JSON.parse(new TextDecoder().decode(metadata));
    const asset = selectOwlyAsset(release, GLib.get_os_info('ID'),
        GLib.get_os_info('ID_LIKE'), architecture.trim());
    onProgress('download');
    const contents = await fetch(session, asset.browser_download_url, cancellable);
    if (contents.length !== asset.size || contents.length > MAX_PACKAGE_SIZE)
        throw new Error('The downloaded package size does not match the release.');
    const digest = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, contents);
    if (`sha256:${digest}` !== asset.digest)
        throw new Error('The downloaded package failed its SHA-256 verification.');
    const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'airdrop', 'packages']);
    if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
        throw new Error('Could not create the package download directory.');
    const path = GLib.build_filenamev([directory, asset.name]);
    GLib.file_set_contents(path, contents);
    return path;
}

export function openOwlyInstaller(path) {
    return Gio.Subprocess.new(['gnome-software', `--local-filename=${path}`],
        Gio.SubprocessFlags.NONE);
}

export {RELEASES_URL};
