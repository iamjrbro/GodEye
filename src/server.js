import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createAuth, demoTenants } from './auth.js';
import { createGraph } from './graph.js';
import { createOperations } from './operations.js';
import { createChat } from './chat.js';
import { AppError, requireRole } from './policy.js';

export function createApp(config = loadConfig()) {
  const app = express(), store = createStore(config.databasePath, config.encryptionKey);
  const auth = createAuth(config, store), graph = createGraph(config, store, auth);
  const operations = createOperations(store, graph, config), chat = createChat(config, graph, operations);
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"], upgradeInsecureRequests: config.production ? [] : null } } }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use(session({ name: 'godeye.sid', secret: config.sessionSecret, store: store.sessions,
    resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: 8 * 3600_000 } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin') !== config.origin) return next(new AppError(403, 'Origem da requisição inválida.'));
    next();
  });
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/auth/login', auth.login);
  app.get('/auth/callback', auth.callback);
  app.post('/auth/logout', (req, res) => {
    req.session.destroy(err => { if (err) return res.status(500).json({ error: 'Falha ao sair.' }); res.clearCookie('godeye.sid'); res.json({ ok: true }); });
  });
  app.get('/api/session', (req, res) => res.json({ actor: req.session.actor || null, mode: config.mode,
    ai: Boolean(config.openaiKey), writes: config.mode === 'demo' || config.writes,
    writeConsent: config.mode === 'demo' || Boolean(req.session.writeConsent), demoTenants: config.mode === 'demo' ? demoTenants : [] }));
  if (config.mode === 'demo') app.post('/api/demo/session', async (req, res) => {
    const { tenant, role } = z.object({ tenant: z.enum(demoTenants.map(t => t.id)), role: z.enum(['reader', 'operator', 'approver']) }).strict().parse(req.body);
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.actor = { tenant, tenantName: demoTenants.find(t => t.id === tenant).name,
      oid: `demo-${role}`, name: { reader: 'Leitor demo', operator: 'Operador demo', approver: 'Aprovador demo' }[role],
      roles: role === 'reader' ? ['GodEye.Reader'] : role === 'operator' ? ['GodEye.Reader', 'GodEye.Operator'] : ['GodEye.Reader', 'GodEye.Operator', 'GodEye.Approver'] };
    store.log(req.session.actor, 'demo.login'); res.json({ ok: true });
  });
  app.use('/api', (req, _res, next) => { if (!req.session.actor) return next(new AppError(401, 'Entre para continuar.')); next(); });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }));
  for (const kind of ['users', 'groups', 'licenses']) app.get(`/api/${kind}`, async (req, res) => res.json(await graph.list(req, kind)));
  app.get('/api/proposals', (req, res) => res.json(store.proposals(req.session.actor.tenant)));
  app.post('/api/proposals', async (req, res) => res.status(201).json(await operations.propose(req, req.body)));
  app.post('/api/proposals/:id/approve', async (req, res) => {
    const { hash } = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    res.json(await operations.approve(req, z.uuid().parse(req.params.id), hash));
  });
  app.post('/api/proposals/:id/reject', (req, res) => {
    const actor = req.session.actor; requireRole(actor, 'GodEye.Approver');
    const id = z.uuid().parse(req.params.id);
    if (!store.reject(actor.tenant, id)) throw new AppError(409, 'Proposta inexistente ou já processada.');
    store.log(actor, 'proposal.rejected', { proposalId: id }); res.json({ status: 'rejected' });
  });
  app.get('/api/audit', (req, res) => res.json(store.audit(req.session.actor.tenant)));
  app.post('/api/chat', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(1).max(3000) }).strict().parse(req.body);
    store.log(req.session.actor, 'chat.request');
    res.json(await chat(req, message));
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { etag: true, maxAge: 0 }));
  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((err, _req, res, _next) => {
    const status = err instanceof z.ZodError ? 400 : err.status || 500;
    // Não registrar objetos de erro externos: podem conter tokens ou dados do tenant.
    if (status >= 500) console.error(JSON.stringify({ event: 'request.failed', status, type: err.constructor.name }));
    res.status(status).json({ error: err instanceof z.ZodError ? 'Dados inválidos. Revise os campos.' : err.status ? err.message : 'Falha interna. Consulte o administrador.' });
  });
  return { app, store };
}
