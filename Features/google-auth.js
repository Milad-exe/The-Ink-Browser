const { shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const url = require('url');

// Generates a secure random string for the PKCE code verifier
function createCodeVerifier() {
    return crypto.randomBytes(32).toString('hex');
}

// Creates a SHA256 hash of the verifier, base64url-encoded, for the PKCE code challenge
function createCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Initiates the Google OAuth 2.0 desktop flow using an external browser.
 * @param {string} clientId     The Google Desktop Application Client ID
 * @param {string} clientSecret The Google Desktop Application Client Secret
 * @param {string} scope        The OAuth scopes to request (space-separated)
 * @returns {Promise<object>}   Resolves with the token response (access_token, refresh_token, etc.)
 */
function loginWithGoogle(clientId, clientSecret, scope = 'email profile') {
    return new Promise((resolve, reject) => {
        const codeVerifier = createCodeVerifier();
        const codeChallenge = createCodeChallenge(codeVerifier);

        const server = http.createServer();
        server.on('request', async (req, res) => {
            const reqUrl = url.parse(req.url, true);
            
            // Only handle the root path with a code or error
            if (reqUrl.pathname !== '/') {
                res.writeHead(404);
                res.end();
                return;
            }

            const authCode = reqUrl.query.code;
            const error = reqUrl.query.error;

            if (authCode) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <head><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#141414;color:#fff;}</style></head>
                        <body>
                            <div style="text-align:center;">
                                <h1>Authentication Successful!</h1>
                                <p>You can now close this tab and return to Ink.</p>
                            </div>
                        </body>
                    </html>
                `);

                // Exchange auth code for tokens
                const port = server.address().port;
                const redirectUri = `http://127.0.0.1:${port}`;

                // Close server so we do not leak resources
                server.close();
                server.destroyAllConnections && server.destroyAllConnections();
                
                try {
                    const tokenResponse = await exchangeCodeForToken(authCode, redirectUri, clientId, clientSecret, codeVerifier);
                    resolve(tokenResponse);
                } catch (exchErr) {
                    reject(exchErr);
                }
            } else if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <head><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#141414;color:#fff;}</style></head>
                        <body>
                            <div style="text-align:center;">
                                <h1 style="color:#e74c3c;">Authentication Failed</h1>
                                <p>Error: ${error}</p>
                                <p>You can close this tab and try again.</p>
                            </div>
                        </body>
                    </html>
                `);
                server.close();
                server.destroyAllConnections && server.destroyAllConnections();
                reject(new Error(`OAuth Error: ${error}`));
            }
        });

        // Listen on any available port on localhost
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const redirectUri = `http://127.0.0.1:${port}`;

            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.append('client_id', clientId);
            authUrl.searchParams.append('redirect_uri', redirectUri);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('scope', scope);
            authUrl.searchParams.append('code_challenge', codeChallenge);
            authUrl.searchParams.append('code_challenge_method', 'S256');
            authUrl.searchParams.append('access_type', 'offline');
            authUrl.searchParams.append('prompt', 'consent'); // Issues refresh token, lets user pick account

            // Open the external browser with the auth URL
            shell.openExternal(authUrl.href);
        });

        // Add support to actively destroy connections so server.close() doesn't hang
        const connections = {};
        server.on('connection', (conn) => {
            const key = conn.remoteAddress + ':' + conn.remotePort;
            connections[key] = conn;
            conn.on('close', () => { delete connections[key]; });
        });
        server.destroyAllConnections = () => {
            for (const key in connections) {
                connections[key].destroy();
            }
        };

        // Timeout after 5 minutes just in case
        setTimeout(() => {
            if (server.listening) {
                server.close();
                server.destroyAllConnections();
                reject(new Error('OAuth flow timed out'));
            }
        }, 5 * 60 * 1000);
    });
}

async function exchangeCodeForToken(authCode, redirectUri, clientId, clientSecret, codeVerifier) {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to exchange code for token. Status: ${response.status}. Body: ${errorBody}`);
    }

    return await response.json();
}

module.exports = {
    loginWithGoogle
};
