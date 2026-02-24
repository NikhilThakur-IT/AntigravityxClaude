/**
 * OAuth callback route handler.
 * Handles the redirect from OAuth providers, exchanges the code
 * for tokens, creates a session, and redirects to the app.
 */

import { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { OAuthProvider, OAuthConfig } from "../types/auth";
import { handleOAuthCallback, getAuthorizationUrl } from "../auth/oauth";
import { SessionManager } from "../auth/session";
import { attachSession, detachSession, AuthenticatedRequest } from "../middleware/auth";

// ── Route: GET /auth/login/:provider ────────────────────────────────────

/**
 * Initiate OAuth login — redirects the user to the provider's consent page.
 */
export function loginHandler(configs: Map<OAuthProvider, OAuthConfig>) {
    return function (req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const provider = url.pathname.split("/").pop() as OAuthProvider;

        const config = configs.get(provider);
        if (!config) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Unsupported provider: ${provider}` }));
            return;
        }

        const authUrl = getAuthorizationUrl(config);
        res.writeHead(302, { Location: authUrl });
        res.end();
    };
}

// ── Route: GET /auth/callback ───────────────────────────────────────────

/**
 * OAuth callback — exchanges code for tokens, creates session, redirects.
 */
export function callbackHandler(
    configs: Map<OAuthProvider, OAuthConfig>,
    sessions: SessionManager,
    options: { successRedirect?: string; failureRedirect?: string } = {}
) {
    const successUrl = options.successRedirect ?? "/";
    const failureUrl = options.failureRedirect ?? "/auth/error";

    return async function (req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state) {
            res.writeHead(302, { Location: `${failureUrl}?error=missing_params` });
            res.end();
            return;
        }

        const result = await handleOAuthCallback(configs, { code, state });

        if (!result.success || !result.user) {
            const encodedError = encodeURIComponent(result.error ?? "unknown");
            res.writeHead(302, {
                Location: `${failureUrl}?error=${encodedError}`,
            });
            res.end();
            return;
        }

        // Create session and set cookie
        const session = await sessions.createSession(result.user);
        attachSession(res, sessions, session);

        res.writeHead(302, { Location: successUrl });
        res.end();
    };
}

// ── Route: POST /auth/logout ────────────────────────────────────────────

/**
 * Logout — destroys the session and clears the cookie.
 */
export function logoutHandler(sessions: SessionManager) {
    return async function (
        req: AuthenticatedRequest,
        res: ServerResponse
    ) {
        if (req.sessionId) {
            await sessions.destroySession(req.sessionId);
        }
        detachSession(res, sessions);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
    };
}

// ── Route: GET /auth/me ─────────────────────────────────────────────────

/**
 * Returns the current user's profile from their session.
 */
export function meHandler() {
    return function (req: AuthenticatedRequest, res: ServerResponse) {
        if (!req.session) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not authenticated" }));
            return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                user: req.session.user,
                csrfToken: req.session.csrfToken,
            })
        );
    };
}
