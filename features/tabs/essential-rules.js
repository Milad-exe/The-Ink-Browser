'use strict';
/**
 * Essentials — the rules, with no Electron in them.
 *
 * An Essential is a PLACE, not a document. The browsers this design follows
 * agree on what that means, in a few consistent rules:
 *
 *   • A pinned favourite lives in every space, shown as an icon, and always
 *     reverts to the original link it was pinned at; you change where it points
 *     by replacing its pinned URL. Clicking its icon resets the tab to that page.
 *   • It is always-visible and capped (around a dozen); closing or unloading one
 *     resets it to its pinned URL, optionally on startup too.
 *   • A pin stays ON ITS SITE: a link leaving the site opens as a floating
 *     preview over it instead of navigating the pin away from the page it is
 *     supposed to be.
 *
 * These are the decisions that follow from that, kept pure so `tests/unit.js`
 * can pin them. The bookkeeping is in features/tabs/essentials.js.
 */
const { getDomain } = require('tldts');

/** The Essential's identity — the url it was created from, plus its container. */
function identity(url, profile) { return `${url}|${profile || ''}`; }

/** The url half of an identity (a url may itself contain a '|'). */
function urlOfIdentity(key) {
    const cut = String(key || '').lastIndexOf('|');
    return cut === -1 ? String(key || '') : String(key).slice(0, cut);
}

/**
 * The key an Essential's TAB is bound under.
 *
 * The tile is global (the same one in every space); the tab it owns is not, or
 * clicking a tile in space B would show you the tab it opened in space A.
 */
const SEP = '\u0000';
function bindingKey(space, key) { return `${space || '1'}${SEP}${key}`; }

/** The identity half of a binding key — which Essential, whatever the space. */
function keyOfBinding(composite) {
    const cut = String(composite || '').indexOf(SEP);
    return cut === -1 ? String(composite || '') : String(composite).slice(cut + SEP.length);
}

/** The registrable domain (eTLD+1) of a url, or '' if it has none. */
function site(url) {
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol))
            return '';
        return getDomain(u.hostname) || u.hostname.toLowerCase();
    }
    catch {
        return '';
    }
}

/** Same site in the cookie sense — www/m/app subdomains are the same place. */
function sameSite(a, b) {
    const x = site(a);
    return !!x && x === site(b);
}

/**
 * Sign-in and payment hand-offs, which genuinely have to leave the site and
 * come back. Peeking those breaks the flow: the redirect lands in a floating
 * preview and the page that asked for it never hears the answer.
 */
const AUTH_PATH = /(^|\/)(oauth2?|openid|login|signin|sign-in|sso|saml|auth|authorize|checkout|connect)(\/|$)/i;
const AUTH_QUERY = /(^|[?&])(client_id|redirect_uri|response_type|oauth_token|sso|continue|returnTo|return_to)=/i;
function isHandoff(url) {
    try {
        const u = new URL(url);
        return AUTH_PATH.test(u.pathname) || AUTH_QUERY.test(u.search);
    }
    catch {
        return false;
    }
}

/**
 * Should a link click inside an Essential's tab open as a glance rather than
 * take the Essential off its site?
 *
 * Only while the tab is actually ON its site — once it has been sent somewhere
 * else deliberately (a typed url, an expanded glance), every click would be
 * "off site" and the preview would stop being an answer to anything.
 */
function shouldPeek(home, current, target) {
    if (!home || !target)
        return false;
    if (!site(home) || !site(target))
        return false;
    if (!sameSite(current || home, home))
        return false;
    if (sameSite(target, home))
        return false;
    return !isHandoff(target);
}

module.exports = { identity, urlOfIdentity, bindingKey, keyOfBinding, site, sameSite, isHandoff, shouldPeek };
