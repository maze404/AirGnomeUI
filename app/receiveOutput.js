// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

export function parseReceiveOffer(line) {
    const match = /^("(?:[^"\\]|\\.)*")\s+\S+(?:\s+(\d+)\s+bytes)?$/.exec(line);
    if (!match)
        return null;
    try {
        const name = JSON.parse(match[1]);
        const size = match[2] === undefined ? null : Number(match[2]);
        if (typeof name !== 'string' || (size !== null && !Number.isSafeInteger(size)))
            return null;
        return {name, size};
    } catch (e) {
        return null;
    }
}
