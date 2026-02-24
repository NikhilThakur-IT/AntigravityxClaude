/**
 * Session management implementation.
 * Provides an in-memory session store with automatic cleanup,
 * CSRF token generation, and session lifecycle management.
 */

import crypto from "crypto";
import { User } from "../types/auth";
import { Session, SessionStore, SessionConfig } from "../types/session";

// ── Default configuration ───────────────────────────────────────────────

const DEFAULT_CONFIG: SessionConfig = {
    maxAge: 24 * 60 * 60,      // 24 hours
    cleanupInterval: 15 * 60,  // 15 minutes
    cookieName: "sid",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
};

// ── In-memory session store ─────────────────────────────────────────────

export class InMemorySessionStore implements SessionStore {
    private sessions = new Map<string, Session>();

    async get(sessionId: string): Promise<Session | null> {
        const session = this.sessions.get(sessionId) ?? null;
        if (session && !session.isActive) {
            this.sessions.delete(sessionId);
            return null;
        }
        if (session && session.expiresAt < new Date()) {
            this.sessions.delete(sessionId);
            return null;
        }
        return session;
    }

    async set(session: Session): Promise<void> {
        this.sessions.set(session.id, session);
    }

    async delete(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
    }

    async cleanup(): Promise<number> {
        const now = new Date();
        let removed = 0;
        for (const [id, session] of this.sessions) {
            if (!session.isActive || session.expiresAt < now) {
                this.sessions.delete(id);
                removed++;
            }
        }
        return removed;
    }

    /** Visible for testing. */
    get size(): number {
        return this.sessions.size;
    }
}

// ── Session manager ─────────────────────────────────────────────────────

export class SessionManager {
    private store: SessionStore;
    private config: SessionConfig;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(store?: SessionStore, config?: Partial<SessionConfig>) {
        this.store = store ?? new InMemorySessionStore();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Create a new session for an authenticated user.
     */
    async createSession(user: User): Promise<Session> {
        const now = new Date();
        const session: Session = {
            id: crypto.randomBytes(32).toString("hex"),
            userId: user.id,
            user,
            csrfToken: crypto.randomBytes(24).toString("hex"),
            createdAt: now,
            expiresAt: new Date(now.getTime() + this.config.maxAge * 1000),
            isActive: true,
        };
        await this.store.set(session);
        return session;
    }

    /**
     * Retrieve and validate a session by ID.
     * Returns null if not found, expired, or inactive.
     */
    async getSession(sessionId: string): Promise<Session | null> {
        return this.store.get(sessionId);
    }

    /**
     * Validate a CSRF token against the session.
     */
    async validateCsrf(sessionId: string, token: string): Promise<boolean> {
        const session = await this.store.get(sessionId);
        if (!session) return false;
        return crypto.timingSafeEqual(
            Buffer.from(session.csrfToken),
            Buffer.from(token)
        );
    }

    /**
     * Destroy a session (logout).
     */
    async destroySession(sessionId: string): Promise<void> {
        await this.store.delete(sessionId);
    }

    /**
     * Refresh a session's expiration.
     */
    async touchSession(sessionId: string): Promise<Session | null> {
        const session = await this.store.get(sessionId);
        if (!session) return null;

        session.expiresAt = new Date(
            Date.now() + this.config.maxAge * 1000
        );
        await this.store.set(session);
        return session;
    }

    /**
     * Start automatic cleanup of expired sessions.
     */
    startCleanup(): void {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(async () => {
            const removed = await this.store.cleanup();
            if (removed > 0) {
                console.log(`[session] Cleaned up ${removed} expired session(s)`);
            }
        }, this.config.cleanupInterval * 1000);
    }

    /**
     * Stop automatic cleanup.
     */
    stopCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /** Expose config for middleware (cookie settings). */
    get cookieConfig() {
        return {
            name: this.config.cookieName,
            secure: this.config.secure,
            httpOnly: this.config.httpOnly,
            sameSite: this.config.sameSite,
            maxAge: this.config.maxAge,
        };
    }
}
