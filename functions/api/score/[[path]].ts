// 信息班评分系统 · online backend (Cloudflare Pages Functions + D1)
// Bindings: DB (D1 database), ADMIN_PASS (secret: the 班长 passcode).
// Tables are created on first use, so no migration step is needed.

interface Env { DB: D1Database; ADMIN_PASS?: string }
type Items = Record<string, number>;
type Sheet = Record<string, Items>;
type Roster = { candidates: string[]; specs: string[] };

const MAX: Record<string, number> = { A1: 15, A2: 10, A3: 10, B1: 10, B2: 10, B3: 5, C1: 10, C2: 10, C3: 5, D1: 8, D2: 7 };
const KEYS = Object.keys(MAX);
const ROLES = ['leader', 'deputy', 'spec', 'peer'];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
const fail = (status: number, error: string) => json({ error }, status);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomKey() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// compare hashes so length/timing says nothing about the passcode
async function samePass(given: string, expected: string) {
  const [a, b] = await Promise.all([sha256('p:' + given), sha256('p:' + expected)]);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

let ready = false;
async function init(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS score_sheets (ym TEXT NOT NULL, role TEXT NOT NULL, sub TEXT NOT NULL, scores TEXT NOT NULL, key_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ym, role, sub))'),
    db.prepare('CREATE TABLE IF NOT EXISTS score_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  ]);
  ready = true;
}
async function getMeta(db: D1Database, k: string) {
  const r = await db.prepare('SELECT v FROM score_meta WHERE k = ?').bind(k).first<{ v: string }>();
  return r ? r.v : null;
}
const setMeta = (db: D1Database, k: string, v: string) =>
  db.prepare('INSERT INTO score_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();
async function getRoster(db: D1Database): Promise<Roster> {
  const v = await getMeta(db, 'roster');
  try { const r = v ? JSON.parse(v) : null; if (r) return r; } catch {}
  return { candidates: [], specs: [] };
}
const isLocked = async (db: D1Database, ym: string) => (await getMeta(db, 'lock:' + ym)) === '1';

const validYm = (ym: unknown): ym is string => typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
function validWho(roster: Roster, role: unknown, sub: unknown): sub is string {
  if (typeof role !== 'string' || !ROLES.includes(role) || typeof sub !== 'string') return false;
  if (role === 'leader' || role === 'deputy') return sub === '';
  if (role === 'spec') return roster.specs.includes(sub);
  return roster.candidates.includes(sub);
}
// clamp every cell to 0..max in 0.5 steps; a peer's own row is always 0
function cleanSheet(roster: Roster, role: string, sub: string, raw: any): Sheet {
  const out: Sheet = {};
  for (const c of roster.candidates) {
    out[c] = {};
    for (const k of KEYS) {
      let v = Number(raw?.[c]?.[k]);
      if (!Number.isFinite(v)) v = 0;
      v = Math.round(Math.min(MAX[k], Math.max(0, v)) * 2) / 2;
      if (role === 'peer' && sub === c) v = 0;
      out[c][k] = v;
    }
  }
  return out;
}
const cleanNames = (a: unknown) =>
  Array.isArray(a) ? [...new Set(a.map((s) => String(s).trim()).filter((s) => s && s.length <= 20))].slice(0, 40) : [];

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!env.DB) return fail(503, '数据库还没有绑定');
  const db = env.DB;
  await init(db);
  const path = ([] as string[]).concat((params as any).path || []).join('/');
  const url = new URL(request.url);
  const method = request.method;
  const body: any = method === 'GET' ? null : await request.json().catch(() => ({}));

  /* ---------- public: roster, lock state, who has submitted (no scores) ---------- */
  if (path === 'state' && method === 'GET') {
    const ym = url.searchParams.get('ym');
    if (!validYm(ym)) return fail(400, '月份不对');
    const { results } = await db.prepare('SELECT role, sub, updated_at FROM score_sheets WHERE ym = ?').bind(ym).all();
    return json({ roster: await getRoster(db), locked: await isLocked(db, ym), submitted: results, keys: KEYS, max: MAX });
  }

  /* ---------- a rater's own sheet ---------- */
  if (path === 'sheet') {
    const roster = await getRoster(db);
    const q = method === 'GET' ? Object.fromEntries(url.searchParams) : body;
    const { ym, role } = q; const sub = q.sub ?? '';
    if (!validYm(ym) || !validWho(roster, role, sub)) return fail(400, '身份或月份不对');
    const key = request.headers.get('x-edit-key') || '';
    const row = await db.prepare('SELECT scores, key_hash, updated_at FROM score_sheets WHERE ym = ? AND role = ? AND sub = ?')
      .bind(ym, role, sub).first<{ scores: string; key_hash: string; updated_at: number }>();
    const mine = !!row && !!key && (await sha256(key)) === row.key_hash;

    if (method === 'GET') {
      if (!row) return json({ exists: false });
      if (!mine) return json({ exists: true, mine: false, updated_at: row.updated_at });
      return json({ exists: true, mine: true, updated_at: row.updated_at, scores: JSON.parse(row.scores) });
    }
    if (method === 'PUT') {
      if (await isLocked(db, ym)) return fail(423, '本月已截止，不能再修改');
      if (row && !mine) return fail(409, '这个身份已经有人提交过了。如需修改，请找班长重置');
      const scores = JSON.stringify(cleanSheet(roster, role, sub, q.scores));
      const now = Date.now();
      if (row) {
        await db.prepare('UPDATE score_sheets SET scores = ?, updated_at = ? WHERE ym = ? AND role = ? AND sub = ?').bind(scores, now, ym, role, sub).run();
        return json({ ok: true, updated_at: now });
      }
      const newKey = randomKey();
      await db.prepare('INSERT INTO score_sheets (ym, role, sub, scores, key_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(ym, role, sub, scores, await sha256(newKey), now).run();
      return json({ ok: true, updated_at: now, key: newKey });
    }
    return fail(405, '不支持');
  }

  /* ---------- 班长 ---------- */
  if (path === 'admin' && method === 'POST') {
    if (!env.ADMIN_PASS) return fail(503, '还没有设置班长口令');
    const pass = request.headers.get('x-admin-pass') || '';
    if (!(await samePass(pass, env.ADMIN_PASS))) {
      await new Promise((r) => setTimeout(r, 800));
      return fail(401, '口令不对');
    }
    const { action, ym } = body;
    if (action === 'roster') {
      const roster = { candidates: cleanNames(body.candidates), specs: cleanNames(body.specs) };
      await setMeta(db, 'roster', JSON.stringify(roster));
      return json({ ok: true, roster });
    }
    if (!validYm(ym)) return fail(400, '月份不对');
    if (action === 'all') {
      const { results } = await db.prepare('SELECT role, sub, scores, updated_at FROM score_sheets WHERE ym = ?').bind(ym).all<any>();
      return json({ sheets: results.map((r) => ({ ...r, scores: JSON.parse(r.scores) })), locked: await isLocked(db, ym) });
    }
    if (action === 'reset') {
      await db.prepare('DELETE FROM score_sheets WHERE ym = ? AND role = ? AND sub = ?').bind(ym, String(body.role), String(body.sub ?? '')).run();
      return json({ ok: true });
    }
    if (action === 'clear') {
      await db.prepare('DELETE FROM score_sheets WHERE ym = ?').bind(ym).run();
      return json({ ok: true });
    }
    if (action === 'lock') {
      await setMeta(db, 'lock:' + ym, body.locked ? '1' : '0');
      return json({ ok: true, locked: !!body.locked });
    }
    return fail(400, '未知操作');
  }

  return fail(404, '没有这个接口');
};
