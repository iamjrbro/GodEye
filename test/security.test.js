import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createStore } from '../src/store.js';
import { createOperations } from '../src/operations.js';
import { assertWritableGroup } from '../src/policy.js';

const tenantA = '11111111-1111-4111-8111-111111111111', tenantB = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', groupId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
async function fixture(t) {
  const config = loadConfig({ APP_MODE: 'demo', DATABASE_PATH: ':memory:' });
  const { app, store } = createApp(config), server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie;
    return async (path, body, origin = config.origin) => {
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const data = await response.json(); return { status: response.status, data };
    };
  };
  return { client, store };
}
test('consulta exige sessão e POST exige origem exata', async t => {
  const { client } = await fixture(t), c = client();
  assert.equal((await c('/api/users')).status, 401);
  assert.equal((await c('/api/demo/session', { tenant: tenantA, role: 'reader' }, 'https://evil.invalid')).status, 403);
});
test('leitor consulta mas não cria propostas; operador não aprova', async t => {
  const { client } = await fixture(t), reader = client(), operator = client();
  await reader('/api/demo/session', { tenant: tenantA, role: 'reader' });
  assert.equal((await reader('/api/users')).status, 200);
  assert.equal((await reader('/api/proposals', { userId, groupId })).status, 403);
  await operator('/api/demo/session', { tenant: tenantA, role: 'operator' });
  const p = (await operator('/api/proposals', { userId, groupId })).data;
  assert.equal((await operator(`/api/proposals/${p.id}/approve`, { hash: p.hash })).status, 403);
});
test('propostas, auditoria e alterações são isoladas por tenant', async t => {
  const { client } = await fixture(t), a = client(), b = client();
  await a('/api/demo/session', { tenant: tenantA, role: 'approver' });
  await b('/api/demo/session', { tenant: tenantB, role: 'approver' });
  const p = (await a('/api/proposals', { userId, groupId })).data;
  assert.equal((await b('/api/proposals')).data.length, 0);
  assert.equal((await b(`/api/proposals/${p.id}/approve`, { hash: p.hash })).status, 404);
  assert.equal((await b('/api/audit')).data.some(e => e.proposalId === p.id), false);
  assert.equal((await a(`/api/proposals/${p.id}/approve`, { hash: p.hash })).data.status, 'succeeded');
  assert.equal((await b('/api/proposals', { userId, groupId })).status, 201);
});
test('hash incorreto é rejeitado; aprovação concorrente executa uma única vez', async t => {
  const { client, store } = await fixture(t), a = client();
  await a('/api/demo/session', { tenant: tenantA, role: 'approver' });
  const p = (await a('/api/proposals', { userId, groupId })).data;
  assert.equal((await a(`/api/proposals/${p.id}/approve`, { hash: '0'.repeat(64) })).status, 409);
  const outcomes = await Promise.all([a(`/api/proposals/${p.id}/approve`, { hash: p.hash }), a(`/api/proposals/${p.id}/approve`, { hash: p.hash })]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), [200, 409]);
  assert.equal(store.audit(tenantA).filter(e => e.action === 'execution.succeeded').length, 1);
});
test('proposta expirada não executa; rejeição impede execução posterior', async t => {
  const { client, store } = await fixture(t), a = client();
  await a('/api/demo/session', { tenant: tenantA, role: 'approver' });
  const p = (await a('/api/proposals', { userId, groupId })).data;
  store.db.prepare('UPDATE proposals SET expires=0 WHERE id=?').run(p.id);
  assert.equal((await a(`/api/proposals/${p.id}/approve`, { hash: p.hash })).status, 409);
  const q = (await a('/api/proposals', { userId, groupId })).data;
  assert.equal((await a(`/api/proposals/${q.id}/reject`, {})).status, 200);
  assert.equal((await a(`/api/proposals/${q.id}/approve`, { hash: q.hash })).status, 409);
});
test('servidor não aceita campos extras, IDs inválidos nem tenant informado na proposta', async t => {
  const { client } = await fixture(t), a = client();
  await a('/api/demo/session', { tenant: tenantA, role: 'operator' });
  assert.equal((await a('/api/proposals', { userId, groupId, tenant: tenantB })).status, 400);
  assert.equal((await a('/api/proposals', { userId: '../users', groupId })).status, 400);
});
test('grupos privilegiados, dinâmicos, sincronizados e distribuição são bloqueados', () => {
  const valid = { isAssignableToRole: false, onPremisesSyncEnabled: null, groupTypes: [], mailEnabled: false };
  assert.doesNotThrow(() => assertWritableGroup(valid));
  for (const patch of [{ isAssignableToRole: true }, { isAssignableToRole: undefined }, { groupTypes: ['DynamicMembership'] }, { onPremisesSyncEnabled: true }, { mailEnabled: true }]) {
    assert.throws(() => assertWritableGroup({ ...valid, ...patch }));
  }
});
test('produção recusa demo, HTTP, ausência de chaves e tenants não cadastrados', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_MODE: 'demo' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_MODE: 'microsoft', APP_URL: 'http://example.com' }));
  assert.throws(() => loadConfig({ APP_MODE: 'microsoft', ALLOWED_TENANT_IDS: tenantA, MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'secret' }));
  assert.throws(() => loadConfig({ APP_MODE: 'microsoft' }));
});
test('sessões são cifradas com autenticação e não aceitam alteração do ciphertext', () => {
  const store = createStore(':memory:', 'a'.repeat(64));
  try {
    const sealed = store.seal({ token: 'secret-token' });
    assert.equal(sealed.includes('secret-token'), false);
    assert.equal(store.open(sealed).token, 'secret-token');
    const bytes = Buffer.from(sealed, 'base64'); bytes[20] ^= 1;
    assert.throws(() => store.open(bytes.toString('base64')));
  } finally { store.close(); }
});
test('falha de rede após envio resulta em uncertain e nunca é reexecutada', async () => {
  const store = createStore(':memory:', 'a'.repeat(64));
  const actor = { tenant: tenantA, oid: 'operator', name: 'Operador', roles: ['GodEye.Operator', 'GodEye.Approver'] };
  const req = { session: { actor } }; let attempts = 0;
  const graph = { user: async () => ({ id: userId, displayName: 'Ana', userPrincipalName: 'ana@example.invalid' }),
    group: async () => ({ id: groupId, displayName: 'Financeiro', isAssignableToRole: false }), member: async () => false,
    add: async () => { attempts++; throw new Error('timeout'); } };
  try {
    const operations = createOperations(store, graph, { mode: 'demo' });
    const p = await operations.propose(req, { userId, groupId });
    await assert.rejects(operations.approve(req, p.id, p.hash), /incerto/);
    assert.equal(store.proposal(tenantA, p.id).status, 'uncertain');
    await assert.rejects(operations.approve(req, p.id, p.hash), /processada/);
    assert.equal(attempts, 1);
  } finally { store.close(); }
});
test('sem IA configurada o chat responde com instrução honesta e não altera o tenant', async t => {
  const { client, store } = await fixture(t), a = client();
  await a('/api/demo/session', { tenant: tenantA, role: 'approver' });
  const r = await a('/api/chat', { message: 'Adicione Ana ao Financeiro' });
  assert.equal(r.status, 200); assert.match(r.data.text, /ainda não foi configurado/);
  assert.equal(store.proposals(tenantA).length, 0);
});
