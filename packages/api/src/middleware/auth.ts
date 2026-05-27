import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@vps-monitoring/shared';

const COOKIE_NAME = 'vpsmon_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const getSecret = (): Uint8Array => new TextEncoder().encode(env.JWT_SECRET);

export interface SessionPayload {
  sub: string;
  username: string;
  role: 'admin';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      sub: String(payload.sub),
      username: String((payload as Record<string, unknown>).username),
      role: 'admin',
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

export async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  getSessionFromRequest(req).then((session) => {
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as Request & { session: SessionPayload }).session = session;
    next();
  }).catch(() => {
    res.status(401).json({ error: 'Unauthorized' });
  });
}

export { COOKIE_NAME, SESSION_MAX_AGE };
