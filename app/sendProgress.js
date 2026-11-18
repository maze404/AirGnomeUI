// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// owly 0.4.x prints progress as "<sent> / <total> bytes".
export function parseSendProgress(line) {
    const match = /^(\d+)\s*\/\s*(\d+)\s+bytes(?=$|peers:)/.exec(line);
    if (!match)
        return null;
    const sent = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isSafeInteger(sent) || !Number.isSafeInteger(total) ||
        total <= 0 || sent > total)
        return null;
    return sent / total;
}

export function sendErrorMessage(line) {
    if (/connection closed before a response/i.test(line))
        return 'Error Client aborted the transfer';
    if (/no AWDL peer answered \/Discover/i.test(line))
        return 'Error: No client found, is the device unlocked with AirDrop on?';
    return line ? `Error: ${line}` : 'Error: Transfer failed';
}
