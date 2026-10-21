import { AppError } from './policy.js';

const demoUsers = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', displayName: 'Ana Costa', userPrincipalName: 'ana@example.invalid', accountEnabled: true },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', displayName: 'Bruno Lima', userPrincipalName: 'bruno@example.invalid', accountEnabled: true },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', displayName: 'Carla Souza', userPrincipalName: 'carla@example.invalid', accountEnabled: false },
];
const demoGroups = [
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', displayName: 'Financeiro', groupTypes: [], mailEnabled: false, securityEnabled: true, isAssignableToRole: false, onPremisesSyncEnabled: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', displayName: 'Tecnologia', groupTypes: ['Unified'], mailEnabled: true, securityEnabled: false, isAssignableToRole: false, onPremisesSyncEnabled: null },
];
export function createGraph(config, store, auth) {
  async function request(req, path, init = {}) {
    const token = await auth.token(req, init.method === 'POST');
    let response;
    try { response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    }); } catch { throw new AppError(502, 'Microsoft Graph indisponível. Se houve envio de alteração, confira o resultado antes de repetir.'); }
    if (!response.ok) {
      if (response.status === 404) throw new AppError(404, 'Objeto não encontrado no tenant conectado.');
      throw new AppError(502, `Microsoft Graph retornou HTTP ${response.status}. Verifique consentimento, função Microsoft e limites do serviço.`);
    }
    return response.status === 204 ? null : response.json();
  }
  const demo = config.mode === 'demo';
  return {
    async list(req, kind) {
      if (demo) return { value: structuredClone(kind === 'users' ? demoUsers : kind === 'groups' ? demoGroups : [{ id: 'demo-sku', skuPartNumber: 'DEMO_EDUCATION', consumedUnits: 18, prepaidUnits: { enabled: 25 } }]), truncated: false, source: 'Dados fictícios' };
      const paths = {
        users: '/users?$select=id,displayName,userPrincipalName,accountEnabled&$top=100',
        groups: '/groups?$select=id,displayName,groupTypes,mailEnabled,securityEnabled,isAssignableToRole,onPremisesSyncEnabled&$top=100',
        licenses: '/subscribedSkus?$select=id,skuPartNumber,consumedUnits,prepaidUnits',
      };
      if (!paths[kind]) throw new AppError(400, 'Consulta não suportada.');
      const result = await request(req, paths[kind]);
      store.log(req.session.actor, `graph.read.${kind}`, { count: result.value.length });
      return { value: result.value, truncated: Boolean(result['@odata.nextLink']), source: 'Microsoft Graph v1.0 · tenant conectado' };
    },
    async user(req, id) {
      if (!demo) return request(req, `/users/${id}?$select=id,displayName,userPrincipalName`);
      const user = demoUsers.find(x => x.id === id); if (!user) throw new AppError(404, 'Usuário não encontrado.'); return structuredClone(user);
    },
    async group(req, id) {
      if (!demo) return request(req, `/groups/${id}?$select=id,displayName,groupTypes,mailEnabled,securityEnabled,isAssignableToRole,onPremisesSyncEnabled`);
      const group = demoGroups.find(x => x.id === id); if (!group) throw new AppError(404, 'Grupo não encontrado.'); return structuredClone(group);
    },
    async member(req, groupId, userId) {
      if (demo) return Boolean(store.db.prepare('SELECT 1 FROM demo_members WHERE tenant=? AND group_id=? AND user_id=?').get(req.session.actor.tenant, groupId, userId));
      try { await request(req, `/groups/${groupId}/members/${userId}?$select=id`); return true; }
      catch (e) { if (e.status === 404) return false; throw e; }
    },
    async add(req, groupId, userId) {
      if (demo) { store.db.prepare('INSERT OR IGNORE INTO demo_members VALUES (?,?,?)').run(req.session.actor.tenant, groupId, userId); return; }
      await request(req, `/groups/${groupId}/members/$ref`, { method: 'POST', body: JSON.stringify({ '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` }) });
    },
  };
}
