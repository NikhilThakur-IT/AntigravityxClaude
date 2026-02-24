/**
 * Session management type definitions.
 */

import { User } from "./auth";

export interface Session {
    id: string;
    userId: string;
    user: User;
    csrfToken: string;
    createdAt: Date;
    expiresAt: Date;
    isActive: boolean;
}

export interface SessionStore {
    get(sessionId: string): Promise<Session | null>;
    set(session: Session): Promise<void>;
    delete(sessionId: string): Promise<void>;
    cleanup(): Promise<number>;
}

export interface SessionConfig {
    maxAge: number;          // seconds
    cleanupInterval: number; // seconds
    cookieName: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "strict" | "lax" | "none";
}
