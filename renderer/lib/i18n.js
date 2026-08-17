/**
 * Browser chrome — localisation and locale-aware formatting.
 *
 * The catalogue arrives in the settings payload (synchronously, like the search
 * engines) because the chrome paints its labels during startup and cannot wait
 * on an async round trip.
 *
 * `apply(root)` localises markup in place: any element with `data-i18n`,
 * `data-i18n-title`, `data-i18n-label` or `data-i18n-placeholder` gets its text
 * or attribute replaced. That keeps the HTML readable — it still ships English
 * as the literal text, which is what shows if a catalogue is missing.
 *
 * The formatters matter as much as the translations: a fixed 24-hour clock and
 * "1.5 MB" with a dot are wrong in most of the world whether or not the UI text
 * has been translated.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.Ink = root.Ink || {};
    root.Ink.i18n = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    let strings = {};
    // Pages that only need FORMATTING (History, Downloads) never call init(),
    // so default to the OS locale rather than to English.
    let locale = (typeof navigator !== 'undefined' && navigator.language) || 'en';

    function init({ catalogue, locale: loc } = {}) {
        strings = catalogue || {};
        locale = loc || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
        return locale;
    }

    /** Translate; unknown keys fall through to the key so nothing renders blank. */
    function t(key, vars) {
        const value = strings[key] ?? key;
        if (!vars)
            return value;
        return String(value).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    }

    /** Localise a DOM subtree in place. */
    function apply(scope) {
        const roots = scope || document;
        for (const el of roots.querySelectorAll('[data-i18n]'))
            el.textContent = t(el.dataset.i18n);
        for (const el of roots.querySelectorAll('[data-i18n-title]'))
            el.title = t(el.dataset.i18nTitle);
        for (const el of roots.querySelectorAll('[data-i18n-label]'))
            el.setAttribute('aria-label', t(el.dataset.i18nLabel));
        for (const el of roots.querySelectorAll('[data-i18n-placeholder]'))
            el.placeholder = t(el.dataset.i18nPlaceholder);
    }

    // ── Formatters ───────────────────────────────────────────────────────────
    const fmt = (kind, opts) => {
        try {
            return new Intl[kind](locale, opts);
        }
        catch {
            return new Intl[kind]('en', opts);
        }
    };

    /** Clock label — 12- or 24-hour according to the locale, not hardcoded. */
    function time(date = new Date()) {
        return fmt('DateTimeFormat', { hour: 'numeric', minute: '2-digit' }).format(date);
    }

    function dateTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        return fmt('DateTimeFormat', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    }

    function date(d) {
        const value = d instanceof Date ? d : new Date(d);
        return fmt('DateTimeFormat', { dateStyle: 'medium' }).format(value);
    }

    /** "3 minutes ago" / "hace 3 minutos", or an absolute date past a week. */
    function relative(when) {
        const then = when instanceof Date ? when : new Date(when);
        const secs = Math.round((then.getTime() - Date.now()) / 1000);
        const abs = Math.abs(secs);
        if (abs > 7 * 86400)
            return date(then);
        const units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7]];
        let value = secs, unit = 'second';
        for (const [name, size] of units) {
            if (Math.abs(value) < size) {
                unit = name;
                break;
            }
            value = Math.round(value / size);
            unit = name === 'day' ? 'week' : units[units.findIndex(u => u[0] === name) + 1][0];
        }
        try {
            return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
        }
        catch {
            return date(then);
        }
    }

    function number(n, opts) {
        return fmt('NumberFormat', opts).format(Number(n) || 0);
    }

    /** File size with the locale's own decimal separator and grouping. */
    function bytes(n) {
        const size = Number(n) || 0;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, value = size;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        const digits = i === 0 ? 0 : (value < 10 ? 1 : 0);
        return `${number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
    }

    const currentLocale = () => locale;

    return { init, t, apply, time, date, dateTime, relative, number, bytes, currentLocale };
});
