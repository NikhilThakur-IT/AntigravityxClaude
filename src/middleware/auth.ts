/**
 * Authentication middleware.
 * Provides Express-compatible middleware for session validation,
 * CSRF protection, and route guarding.
 */

import { IncomingMessage, ServerResponse } from "http";
import { SessionManager } from "../auth/session";
import { Session } from "../types/session";

// ── Extend request with auth context ────────────────────────────────────

export interface AuthenticatedRequest extends IncomingMessage {
    session?: Session;
    sessionId?: string;
}

type NextFn = (err?: Error) => void;

// ── Cookie helpers ──────────────────────────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};
    return Object.fromEntries(
        header
            .split(";")
            .map((c) => c.trim().split("="))
            .filter(([k]) => k)
            .map(([k, ...v]) => [k, v.join("=")])
    );
}

function setSessionCookie(
    res: ServerResponse,
    name: string,
    value: string,
    options: {
        maxAge: number;
        secure: boolean;
        httpOnly: boolean;
        sameSite: string;
    }
): void {
    const parts = [
        `${name}=${value}`,
        `Max-Age=${options.maxAge}`,
        `Path=/`,
        `SameSite=${options.sameSite}`,
    ];
    if (options.httpOnly) parts.push("HttpOnly");
    if (options.secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: ServerResponse, name: string): void {
    res.setHeader("Set-Cookie", `${name}=; Max-Age=0; Path=/`);
}

// ── Middleware factory ──────────────────────────────────────────────────

/**
 * Creates middleware that attaches the session to `req.session`
 * if a valid session cookie is present. Does NOT block unauthenticated
 * requests — use `requireAuth` for that.
 */
export function sessionMiddleware(sessions: SessionManager) {
    const cookie = sessions.cookieConfig;

    return async function (
        req: AuthenticatedRequest,
        _res: ServerResponse,
        next: NextFn
    ) {
        try {
            const cookies = parseCookies(req.headers.cookie);
            const sid = cookies[cookie.name];

            if (sid) {
                const session = await sessions.getSession(sid);
                if (session) {
                    req.session = session;
                    req.sessionId = sid;
                    // Touch to extend expiry on each request
                    await sessions.touchSession(sid);
                }
            }
            next();
        } catch (err) {
            next(err instanceof Error ? err : new Error(String(err)));
        }
    };
}

/**
 * Guard middleware — rejects unauthenticated requests with 401.
 */
export function requireAuth() {
    return function (
        req: AuthenticatedRequest,
        res: ServerResponse,
        next: NextFn
    ) {
        if (!req.session) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Authentication required" }));
            return;
        }
        next();
    };
}

/**
 * CSRF protection middleware.
 * Validates the `x-csrf-token` header against the session's CSRF token
 * for state-changing methods (POST, PUT, PATCH, DELETE).
 */
export function csrfProtection(sessions: SessionManager) {
    const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

    return async function (
        req: AuthenticatedRequest,
        res: ServerResponse,
        next: NextFn
    ) {
        if (SAFE_METHODS.has(req.method ?? "GET")) {
            return next();
        }

        const sid = req.sessionId;
        const token = req.headers["x-csrf-token"] as string | undefined;

        if (!sid || !token) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "CSRF token missing" }));
            return;
        }

        const valid = await sessions.validateCsrf(sid, token);
        if (!valid) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "CSRF token invalid" }));
            return;
        }

        next();
    };
}

/**
 * Helper: set session cookie after login.
 */
export function attachSession(
    res: ServerResponse,
    sessions: SessionManager,
    session: { id: string }
): void {
    const cookie = sessions.cookieConfig;
    setSessionCookie(res, cookie.name, session.id, cookie);
}

/**
 * Helper: clear session cookie on logout.
 */
export function detachSession(
    res: ServerResponse,
    sessions: SessionManager
): void {
    clearSessionCookie(res, sessions.cookieConfig.name);
}
