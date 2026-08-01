'use strict';
/**
 * Per-site isolation policy — decides which sites auto-open in their own isolated
 * instance (features/containers.js) instead of the shared default session.
 *
 * The need: multi-tenant apps (SuccessFactors, Salesforce, Workday…) key logins
 * off cookies, so two tenants in the default jar clobber each other. This store
 * remembers, per registrable site, whether to isolate:
 *
 *   policyFor(host) →
 *     'isolate'  user (or panel) turned it on           → auto-route to instance
 *     'no'       user turned it off                      → always default session
 *     'ask'      a known multi-tenant app, not yet decided → prompt on first open
 *     'off'      anything else                           → default session
 *
 * User decisions override the built-in list and persist encrypted (like
 * site-permissions.js). Emits 'change' (site) when a rule changes.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { parse: parseTld } = require('tldts');
const { encrypt, decrypt, isEncrypted } = require('./encryption');

// Known multi-tenant SaaS whose tenants live on distinct hosts and commonly need
// separate concurrent logins. Registrable (eTLD+1) domains. Deliberately EXCLUDES
// pure identity providers (Google/Microsoft/Okta sign-in) so SSO redirect chains
// that begin on the default session complete normally.
const BUILTIN_ISOLATE = new Set([
    'successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu',
    'salesforce.com', 'force.com',
    'workday.com', 'myworkday.com',
    'servicenow.com',
    'zendesk.com',
    'atlassian.net',
    'box.com',
    'docusign.net',
]);

class IsolationRules extends EventEmitter {
    constructor() {
        super();
        this.file = null;
        this.data = { rules: {} }; // { site → 'isolate' | 'no' }
        this.loaded = false;
    }
    _load() {
        if (this.loaded)
            return;
        this.file = path.join(app.getPath('userData'), 'isolation-rules.dat');
        try {
            if (fs.existsSync(this.file)) {
                const raw = fs.readFileSync(this.file, 'utf-8');
                const obj = JSON.parse(isEncrypted(raw) ? decrypt(raw) : raw) || {};
                this.data = { rules: obj.rules || {} };
            }
        }
        catch {
            this.data = { rules: {} };
        }
        this.loaded = true;
    }
    _save() {
        try {
            fs.writeFileSync(this.file, encrypt(JSON.stringify(this.data)), { mode: 0o600 });
        }
        catch { }
    }
    // Registrable site ("eTLD+1") for a URL or bare hostname — isolation is scoped
    // per site, not per full hostname (all *.successfactors.com share one rule).
    siteOf(urlOrHost) {
        try {
            const host = String(urlOrHost).includes('://') ? new URL(urlOrHost).hostname : String(urlOrHost);
            return parseTld(host, { allowPrivateDomains: true }).domain || host;
        }
        catch {
            return null;
        }
    }
    isBuiltin(site) { return BUILTIN_ISOLATE.has(site); }
    // 'isolate' | 'no' | 'ask' | 'off'
    policyFor(urlOrHost) {
        this._load();
        const site = this.siteOf(urlOrHost);
        if (!site)
            return 'off';
        const rule = this.data.rules[site];
        if (rule === 'isolate' || rule === 'no')
            return rule;
        return BUILTIN_ISOLATE.has(site) ? 'ask' : 'off';
    }
    // Set/clear a rule. value: 'isolate' | 'no' | null (clear → back to default).
    set(urlOrHost, value) {
        this._load();
        const site = this.siteOf(urlOrHost);
        if (!site)
            return;
        if (value === 'isolate' || value === 'no')
            this.data.rules[site] = value;
        else
            delete this.data.rules[site];
        this._save();
        this.emit('change', site);
    }
    clear(urlOrHost) { this.set(urlOrHost, null); }
    // Explicit user rules (not the built-in defaults) for the manage UI.
    list() {
        this._load();
        return Object.entries(this.data.rules).map(([site, policy]) => ({ site, policy }));
    }
}

module.exports = new IsolationRules();
module.exports.BUILTIN_ISOLATE = BUILTIN_ISOLATE;
