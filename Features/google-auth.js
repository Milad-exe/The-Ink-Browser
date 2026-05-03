const { shell } = require('electron');
const crypto = require('crypto');

const REDIRECT_URI = 'ink://oauth';

function createCodeVerifier() {
    return crypto.randomBytes(32).toString('hex');
}

function createCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

// ── Pending OAuth state ───────────────────────────────────────────────────────
// Only one flow can be in-flight at a time.
let _resolve      = null;
let _reject       = null;
let _verifier     = null;
let _clientId     = null;
let _clientSecret = null;
let _timeout      = null;

function clearPending() {
    if (_timeout) clearTimeout(_timeout);
    _resolve = _reject = _verifier = _clientId = _clientSecret = _timeout = null;
}

/**
 * Initiates the Google OAuth 2.0 desktop flow using the system browser.
 * Google redirects to ink://oauth?code=… which the OS routes back to this
 * app via the registered ink:// protocol handler — no local HTTP server needed.
 *
 * Requires ink://oauth to be listed as an authorised redirect URI in the
 * Google Cloud Console OAuth 2.0 client (Desktop app type).
 */
function loginWithGoogle(clientId, clientSecret, scope = 'email profile') {
    return new Promise((resolve, reject) => {
        if (_reject) _reject(new Error('New login attempt started'));
        clearPending();

        const verifier  = createCodeVerifier();
        const challenge = createCodeChallenge(verifier);

        _resolve      = resolve;
        _reject       = reject;
        _verifier     = verifier;
        _clientId     = clientId;
        _clientSecret = clientSecret;

        _timeout = setTimeout(() => {
            clearPending();
            reject(new Error('OAuth flow timed out'));
        }, 5 * 60 * 1000);

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.append('client_id',             clientId);
        authUrl.searchParams.append('redirect_uri',          REDIRECT_URI);
        authUrl.searchParams.append('response_type',         'code');
        authUrl.searchParams.append('scope',                 scope);
        authUrl.searchParams.append('code_challenge',        challenge);
        authUrl.searchParams.append('code_challenge_method', 'S256');
        authUrl.searchParams.append('access_type',           'offline');
        authUrl.searchParams.append('prompt',                'consent');

        shell.openExternal(authUrl.href);
    });
}

/**
 * Called from main.js when the OS delivers an ink:// URL back to this process.
 *   macOS:         app 'open-url' event
 *   Windows/Linux: app 'second-instance' argv
 */
function handleProtocolCallback(callbackUrl) {
    if (!_resolve) return;

    const resolve      = _resolve;
    const reject       = _reject;
    const verifier     = _verifier;
    const clientId     = _clientId;
    const clientSecret = _clientSecret;
    clearPending();

    let parsed;
    try { parsed = new URL(callbackUrl); } catch {
        return reject(new Error('Malformed OAuth callback URL'));
    }

    const code  = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (error) {
        reject(new Error(`OAuth Error: ${error}`));
    } else if (code) {
        exchangeCodeForToken(code, REDIRECT_URI, clientId, clientSecret, verifier)
            .then(resolve)
            .catch(reject);
    } else {
        reject(new Error('OAuth callback contained neither code nor error'));
    }
}

async function exchangeCodeForToken(authCode, redirectUri, clientId, clientSecret, codeVerifier) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'authorization_code',
            code:          authCode,
            redirect_uri:  redirectUri,
            client_id:     clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
        }).toString(),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Token exchange failed — ${response.status}: ${body}`);
    }

    return response.json();
}

module.exports = { loginWithGoogle, handleProtocolCallback };
