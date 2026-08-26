import { makeId, normalizeSession, now, readBearerToken, type AdminSessionRecord } from './http';

export const createAdminSession = async (db: D1Database, username: string) => {
  const token = makeId('session');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  await db
    .prepare(
      `INSERT INTO admin_sessions (token, username, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token, username, expiresAt, createdAt)
    .run();

  return { token, username, expiresAt } satisfies AdminSessionRecord;
};

export const getAdminSessionFromRequest = async (db: D1Database, request: Request) => {
  const token = readBearerToken(request);
  if (!token) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT token, username, expires_at
       FROM admin_sessions
       WHERE token = ?
       LIMIT 1`,
    )
    .bind(token)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const session = normalizeSession(row);
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
    return null;
  }

  return session;
};

export const deleteAdminSession = async (db: D1Database, request: Request) => {
  const token = readBearerToken(request);
  if (!token) {
    return;
  }

  await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
};
