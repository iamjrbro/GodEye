import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import session from 'express-session';

export function createStore(path, key) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, status TEXT NOT NULL, expires INTEGER NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, created TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_members (tenant TEXT, group_id TEXT, user_id TEXT, PRIMARY KEY(tenant,group_id,user_id));`);
  const secret = Buffer.from(key, 'hex');
  function seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  function open(value) {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'));
  }
  class SessionStore extends session.Store {
    get(id, cb) { try { const row = db.prepare('SELECT value FROM sessions WHERE id=? AND expires>?').get(id, Date.now()); cb(null, row ? open(row.value) : null); } catch (e) { cb(e); } }
    set(id, value, cb = () => {}) { try { db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(id, seal(value), Date.now() + 8 * 3600_000); cb(); } catch (e) { cb(e); } }
    destroy(id, cb = () => {}) { try { db.prepare('DELETE FROM sessions WHERE id=?').run(id); cb(); } catch (e) { cb(e); } }
    touch(id, value, cb = () => {}) { this.set(id, value, cb); }
  }
  function log(actor, action, details = {}) {
    const event = { id: randomUUID(), created: new Date().toISOString(), actor: actor.oid, action, ...details };
    db.prepare('INSERT INTO audit VALUES (?,?,?,?)').run(event.id, actor.tenant, event.created, seal(event));
    return event;
  }
  return {
    db, sessions: new SessionStore(), seal, open, log,
    audit: tenant => db.prepare('SELECT value FROM audit WHERE tenant=? ORDER BY created DESC LIMIT 100').all(tenant).map(r => open(r.value)),
    proposals: tenant => db.prepare('SELECT value,status FROM proposals WHERE tenant=? ORDER BY rowid DESC LIMIT 100').all(tenant).map(r => ({ ...open(r.value), status: r.status })),
    proposal: (tenant, id) => { const r = db.prepare('SELECT value,status FROM proposals WHERE tenant=? AND id=?').get(tenant, id); return r ? { ...open(r.value), status: r.status } : undefined; },
    insertProposal: p => db.prepare('INSERT INTO proposals VALUES (?,?,?,?,?)').run(p.id, p.tenant, p.status, p.expires, seal(p)),
    claim: (tenant, id) => db.prepare("UPDATE proposals SET status='executing' WHERE tenant=? AND id=? AND status='pending' AND expires>?").run(tenant, id, Date.now()).changes === 1,
    status: (tenant, id, status) => db.prepare('UPDATE proposals SET status=? WHERE tenant=? AND id=?').run(status, tenant, id),
    reject: (tenant, id) => db.prepare("UPDATE proposals SET status='rejected' WHERE tenant=? AND id=? AND status='pending'").run(tenant, id).changes === 1,
    close: () => db.close(),
  };
}
