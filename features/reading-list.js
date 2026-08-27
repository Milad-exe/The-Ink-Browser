'use strict';
/**
 * ReadingList — main-process logic.
 *
 * Keep the browser-facing surface here; ipc/reading-list.js is only the wiring that
 * lets the renderer call in. Log errors through features/log rather than
 * swallowing them (CLAUDE.md invariant 11).
 */
const log = require('./log');

// Persisted settings must be declared in features/persistence.js DEFAULTS, or
// Persistence.set() drops them silently (invariant 1).

function doSomething(input) {
    // TODO: real logic.
    log.debug('reading-list', 'doSomething', input);
    return { ok: true, echo: input };
}

module.exports = { doSomething };
