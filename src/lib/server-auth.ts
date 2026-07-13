import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const AUTH_COOKIE_NAME = 'teacherpro_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type DbUserWithRole = Awaited<ReturnType<typeof findUserById>>;

export interface AuthPrincipal {
  id: string;
  username: string;
  name: string;
  role: string;
  roleId: string | null;
  permissions: string[];
  active: boolean;
  isAdmin: boolean;
}

interface SignedSessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function readEnv(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

function getAuthSecret(): string {
  const secret = readEnv('TEACHERPRO_AUTH_SECRET') || readEnv('AUTH_SECRET') || readEnv('NEXTAUTH_SECRET');
  if (secret?.trim()) return secret.trim();

  if (readEnv('NODE_ENV') === 'production') {
    throw new Error('TEACHERPRO_AUTH_SECRET مطلوب في بيئة الإنتاج لتوقيع جلسات الدخول.');
  }

  return 'teacherpro-local-dev-secret';
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sign(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function parsePermissionList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function mergePermissions(...values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap(parsePermissionList)));
}

function isAdminUser(user: { username?: string | null; roleId?: string | null; role?: string | null }): boolean {
  return String(user.username || '').trim().toLowerCase() === 'admin'
    || String(user.roleId || '') === 'role_admin';
}

async function findUserById(id: string) {
  return db.appUser.findUnique({
    where: { id },
    include: { roleRef: true },
  });
}

export async function findUserByUsername(username: string) {
  return db.appUser.findFirst({
    where: { username: { equals: username.trim(), mode: 'insensitive' } },
    include: { roleRef: true },
  });
}

export function toAuthPrincipal(user: NonNullable<DbUserWithRole>): AuthPrincipal {
  const permissions = mergePermissions(user.roleRef?.permissions, user.permissions);
  const isAdmin = isAdminUser(user);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleId: user.roleId,
    permissions,
    active: user.active,
    isAdmin,
  };
}

export async function createSessionToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedSessionPayload = {
    sub: userId,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${await sign(encodedPayload)}`;
}

async function readSessionPayload(req: NextRequest): Promise<SignedSessionPayload | null> {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature || !safeEqual(await sign(encodedPayload), signature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SignedSessionPayload>;
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as SignedSessionPayload;
  } catch {
    return null;
  }
}

export async function getAuthPrincipal(req: NextRequest): Promise<AuthPrincipal | null> {
  const payload = await readSessionPayload(req);
  if (!payload) return null;
  const user = await findUserById(payload.sub);
  if (!user || !user.active) return null;
  return toAuthPrincipal(user);
}

export async function setAuthCookie(res: NextResponse, userId: string): Promise<void> {
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await createSessionToken(userId),
    httpOnly: true,
    sameSite: 'lax',
    secure: readEnv('NODE_ENV') === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: readEnv('NODE_ENV') === 'production',
    path: '/',
    maxAge: 0,
  });
}

// ============================================================================
// Permission aliases — IMPORTANT: read the security note below before editing.
// ----------------------------------------------------------------------------
// Q89 SECURITY FIX: Previously, many `*.add`/`*.edit`/`*.delete` permissions
// were aliased to the same `page.*.view` token as their `*.view` counterpart.
// This meant any user granted "view" permission on a page implicitly received
// add/edit/delete permissions too — a privilege escalation vulnerability.
//
// Fix: aliases now follow a strict rule:
//   - `page.*.view` tokens only grant VIEW access (UI rendering, GET handlers)
//   - `*.add`/`*.edit`/`*.delete`/`*.manage` permissions must be granted
//     EXPLICITLY in the user's role. They have NO aliases to view tokens.
//   - The ONLY exception is when a "manage" permission genuinely implies
//     "view" (e.g. accounts.manage implies accounts.view) — but never the
//     reverse.
//
// Migration impact:
//   - The default admin role (role_admin) already grants all permissions
//     explicitly via admin-seed.ts, so admin access is unaffected.
//   - Custom roles that relied on the old alias behavior (granting only
//     `page.courses.view` and expecting edit access) will lose edit access.
//     Operators must update these roles in the accounts UI to grant
//     `courses.add`/`courses.edit`/`courses.delete` explicitly.
//   - This is intentional — the old behavior was a security hole.
// ============================================================================
const SERVER_PERMISSION_EQUIVALENTS: Record<string, string[]> = {
  "system.dashboard": ["page.dashboard.view"],

  // Courses: view-only alias; add/edit/delete must be granted explicitly
  "courses.view": ["page.courses.view"],
  "courses.add": [],
  "courses.edit": [],
  "courses.delete": [],

  // Chapters: view-only alias; add/edit/delete must be granted explicitly
  "chapters.view": ["page.chapters.view"],
  "chapters.add": [],
  "chapters.edit": [],
  "chapters.delete": [],

  // Students: view-only alias; add/edit/delete must be granted explicitly
  "students.view": ["page.student-registry.view", "page.dismissed-students.view"],
  "students.add": ["page.student-register.view", "page.student-bulk-import.view"],
  "students.edit": ["students.dismiss", "students.reactivate"],
  "students.delete": [],

  // Exams: view-only alias; add/edit/delete must be granted explicitly
  "exams.view": ["page.exam-records.view"],
  "exams.add": ["page.exam-new.view"],
  "exams.edit": [],
  "exams.delete": [],

  // Grades: view-only alias; add/edit/delete must be granted explicitly
  "grades.view": ["page.grade-records.view", "page.missing-students-notes.view"],
  "grades.add": ["page.grade-entry.view"],
  "grades.edit": [],
  "grades.delete": [],

  // Opportunities: manage does NOT alias to view anymore (Q89 fix)
  "opportunities.view": ["page.opportunities.view"],
  "opportunities.manage": [],

  // Follow-up: view-only alias; manage must be granted explicitly
  "follow-up.view": ["page.follow-up-calls.view", "page.follow-up-leaves.view", "page.follow-up-pledges.view"],
  "follow-up.manage": ["follow-up.calls.manage", "follow-up.leaves.manage", "follow-up.pledges.manage"],

  // Correction: manage does NOT alias to view anymore (Q89 fix)
  "correction.view": ["page.e-correction.view"],
  "correction.manage": [],

  // Accounts: view-only alias; manage must be granted explicitly
  "accounts.view": ["page.accounts.view", "accounts.users.view", "accounts.roles.view", "accounts.security.view"],
  "accounts.manage": ["accounts.users.add", "accounts.users.edit", "accounts.users.delete", "accounts.roles.add", "accounts.roles.edit", "accounts.roles.delete", "accounts.permissions.manage"],

  // Logs: view-only alias; clear/restore must be granted explicitly
  "logs.view": ["page.logs.view", "logs.export"],
  "logs.clear": ["page.admin-log-reset.manage"],
  "logs.restore": ["page.admin-log-reset.manage"],

  // Backup: view (export) and restore are separate permissions (Q91+Q92 fix)
  "backup.view": [],
  "backup.restore": [],
};

function hasPermission(principal: AuthPrincipal, permission: string): boolean {
  if (principal.isAdmin || principal.permissions.includes(permission)) return true;
  return (SERVER_PERMISSION_EQUIVALENTS[permission] || []).some((alias) =>
    principal.permissions.includes(alias),
  );
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'ليست لديك صلاحية لتنفيذ هذه العملية.' }, { status: 403 });
}

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const principal = await getAuthPrincipal(req);
  return principal ? null : unauthorizedResponse();
}

export async function requirePermission(req: NextRequest, permission: string): Promise<NextResponse | null> {
  const principal = await getAuthPrincipal(req);
  if (!principal) return unauthorizedResponse();
  return hasPermission(principal, permission) ? null : forbiddenResponse();
}

export async function requirePermissionPrincipal(req: NextRequest, permission: string): Promise<AuthPrincipal | NextResponse> {
  const principal = await getAuthPrincipal(req);
  if (!principal) return unauthorizedResponse();
  return hasPermission(principal, permission) ? principal : forbiddenResponse();
}

export async function requireAnyPermission(req: NextRequest, permissions: string[]): Promise<NextResponse | null> {
  const principal = await getAuthPrincipal(req);
  if (!principal) return unauthorizedResponse();
  return permissions.some((permission) => hasPermission(principal, permission)) ? null : forbiddenResponse();
}
