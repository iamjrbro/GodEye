const $ = id => document.getElementById(id);
const state = { session: null, view: 'chat', proposals: [], busy: false };
const names = { chat: 'Assistente', users: 'Usuários', groups: 'Grupos', licenses: 'Licenças', proposals: 'Aprovações', audit: 'Auditoria', connections: 'Conexões' };
const statuses = { pending: 'Aguardando aprovação', executing: 'Execução iniciada · verificar resultado', succeeded: 'Concluída e verificada', rejected: 'Rejeitada', stale: 'Estado alterado · recriar proposta', uncertain: 'Resultado incerto · verificar no Entra', pending_verification: 'Enviada · verificação pendente' };
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(result.error || `HTTP ${r.status}`);
  return result;
}
async function guarded(work, button) {
  if (button) button.disabled = true;
  try { await work(); } catch (e) { notice(e.message); } finally { if (button) button.disabled = false; }
}
async function initialize() {
  state.session = await api('/api/session');
  const s = state.session, actor = s.actor;
  $('environment-badge').textContent = s.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'MICROSOFT 365';
  $('login-panel').hidden = Boolean(actor); $('workspace-content').hidden = !actor; $('logout').hidden = !actor;
  $('demo-form').hidden = s.mode !== 'demo'; $('microsoft-login').hidden = s.mode === 'demo';
  $('demo-tenant').replaceChildren(...s.demoTenants.map(t => { const o = el('option', t.name); o.value = t.id; return o; }));
  if (s.mode === 'demo') notice('Modo demonstração: empresas e dados fictícios. Nenhuma alteração é enviada à Microsoft.');
  if (!actor) return;
  $('tenant-name').textContent = actor.tenantName;
  $('mode-label').textContent = actor.name;
  $('data-label').textContent = s.mode === 'demo' ? 'Dados fictícios' : 'Microsoft Graph';
  $('chat-state').textContent = s.ai ? 'IA habilitada · mensagem independente' : 'Configure a IA ou use as consultas nas abas';
  $('tenant-detail').textContent = `Tenant atual: ${actor.tenant}. Papéis: ${actor.roles.join(', ')}.`;
  $('new-proposal').disabled = !actor.roles.includes('GodEye.Operator') || !s.writes;
  $('write-login').hidden = s.mode === 'demo' || !s.writes;
  await refreshProposals(); await navigate(state.view);
}
function table(columns, rows, target) {
  const t = el('table'), head = el('thead'), tr = el('tr');
  columns.forEach(c => tr.append(el('th', c))); head.append(tr); t.append(head);
  const body = el('tbody');
  rows.forEach(row => { const r = el('tr'); row.forEach(value => { const cell = el('td'); if (value instanceof Node) cell.append(value); else cell.textContent = String(value ?? '—'); r.append(cell); }); body.append(r); });
  t.append(body); target.replaceChildren(rows.length ? t : el('div', 'Nenhum registro disponível.', 'empty'));
}
async function navigate(view) {
  state.view = view; $('page-title').textContent = names[view];
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('.view').forEach(n => n.hidden = true);
  if (!state.session.actor) return;
  if (['users', 'groups', 'licenses'].includes(view)) {
    $('view-data').hidden = false; $('data-title').textContent = names[view];
    $('data-table').replaceChildren(el('div', 'Consultando o tenant…', 'empty'));
    const data = await api(`/api/${view}`);
    $('data-subtitle').textContent = `${data.source}. ${data.value.length} registros exibidos.${data.truncated ? ' Há mais registros no tenant; esta versão mostra os primeiros 100.' : ''}`;
    if (view === 'users') table(['Nome', 'Login', 'Status'], data.value.map(u => [u.displayName, u.userPrincipalName, u.accountEnabled ? 'Ativo' : 'Desabilitado']), $('data-table'));
    if (view === 'groups') table(['Nome', 'Tipo', 'Object ID'], data.value.map(g => [g.displayName, g.groupTypes?.includes('Unified') ? 'Microsoft 365' : 'Segurança / outro', g.id]), $('data-table'));
    if (view === 'licenses') table(['Produto', 'Em uso', 'Capacidade habilitada'], data.value.map(l => [l.skuPartNumber, l.consumedUnits, l.prepaidUnits?.enabled]), $('data-table'));
  } else {
    $(`view-${view}`).hidden = false;
    if (view === 'proposals') await refreshProposals();
    if (view === 'audit') {
      const events = await api('/api/audit');
      table(['Quando', 'Evento', 'Ator', 'Referência'], events.map(e => [new Date(e.created).toLocaleString('pt-BR'), e.action, e.actor, e.proposalId || '—']), $('audit-list'));
    }
  }
}
async function refreshProposals() {
  state.proposals = await api('/api/proposals');
  $('pending-count').textContent = state.proposals.filter(p => p.status === 'pending' && p.expires > Date.now()).length;
  const cards = state.proposals.map(p => {
    const card = el('article', undefined, 'proposal-card'), top = el('div', undefined, 'proposal-top');
    const intro = el('div'); intro.append(el('h2', `${p.user.displayName} → ${p.group.displayName}`), el('p', 'Adicionar usuário como membro do grupo'));
    const expired = p.status === 'pending' && p.expires <= Date.now();
    top.append(intro, el('span', expired ? 'Expirada' : statuses[p.status] || p.status, 'badge')); card.append(top);
    const detail = el('div', undefined, 'proposal-details');
    [`Tenant: ${p.tenant}`, `Usuário: ${p.user.userPrincipalName} · ${p.user.id}`, `Grupo: ${p.group.displayName} · ${p.group.id}`, `Estado: não é membro → membro`, `Solicitado por: ${p.requestedByName}`, `Validade: ${new Date(p.expires).toLocaleString('pt-BR')}`].forEach(text => detail.append(el('div', text)));
    card.append(detail, el('p', p.impact), el('code', `SHA-256: ${p.hash}`));
    if (p.status === 'pending' && !expired) {
      const actions = el('div', undefined, 'proposal-actions'), approve = el('button', 'Aprovar e executar', 'primary'), reject = el('button', 'Rejeitar', 'secondary');
      const allowed = state.session.actor.roles.includes('GodEye.Approver');
      approve.disabled = !allowed || !state.session.writeConsent; reject.disabled = !allowed;
      approve.addEventListener('click', () => guarded(async () => {
        if (!confirm(`Autorizar no tenant ${p.tenant}?\n\nAdicionar ${p.user.userPrincipalName} ao grupo ${p.group.displayName}.\n\n${p.impact}`)) return;
        try { const r = await api(`/api/proposals/${p.id}/approve`, { hash: p.hash }); notice(statuses[r.status]); }
        finally { await refreshProposals(); }
      }, approve));
      reject.addEventListener('click', () => guarded(async () => { await api(`/api/proposals/${p.id}/reject`, {}); await refreshProposals(); }, reject));
      actions.append(approve, reject);
      if (!allowed) actions.append(el('small', 'Um usuário com papel de aprovador precisa revisar esta proposta.'));
      else if (!state.session.writeConsent) actions.append(el('small', 'Reconecte com consentimento de escrita na aba Conexões.'));
      card.append(actions);
    }
    return card;
  });
  $('proposals-list').replaceChildren(...(cards.length ? cards : [el('div', 'Nenhuma alteração proposta.\nCrie uma proposta pelo assistente ou pelo botão Nova alteração.', 'empty')]));
}
async function openProposal() {
  if (!state.session.actor?.roles.includes('GodEye.Operator')) throw new Error('Seu usuário precisa do papel GodEye.Operator.');
  const [users, groups] = await Promise.all([api('/api/users'), api('/api/groups')]);
  function options(values, label) { return values.map(v => { const option = el('option', label(v)); option.value = v.id; return option; }); }
  $('proposal-user').replaceChildren(...options(users.value, u => `${u.displayName} · ${u.userPrincipalName}`));
  const eligible = groups.value.filter(g => g.isAssignableToRole === false && !g.onPremisesSyncEnabled && !g.groupTypes?.includes('DynamicMembership') && (!g.mailEnabled || g.groupTypes?.includes('Unified')));
  $('proposal-group').replaceChildren(...options(eligible, g => g.displayName));
  if (!users.value.length || !eligible.length) throw new Error('Não há usuários ou grupos elegíveis nos registros disponíveis.');
  $('proposal-dialog').showModal();
}
document.querySelectorAll('[data-view]').forEach(n => n.addEventListener('click', () => guarded(() => navigate(n.dataset.view))));
document.querySelectorAll('[data-query]').forEach(n => n.addEventListener('click', () => { $('message').value = n.dataset.query; $('message').focus(); }));
$('demo-form').addEventListener('submit', e => { e.preventDefault(); guarded(async () => { await api('/api/demo/session', { tenant: $('demo-tenant').value, role: $('demo-role').value }); await initialize(); }, e.submitter); });
$('logout').addEventListener('click', () => guarded(async () => { await api('/auth/logout', {}); window.location.assign('/'); }));
$('refresh-data').addEventListener('click', e => guarded(() => navigate(state.view), e.currentTarget));
$('new-proposal').addEventListener('click', () => guarded(openProposal));
$('quick-proposal').addEventListener('click', () => guarded(openProposal));
$('close-dialog').addEventListener('click', () => $('proposal-dialog').close());
$('proposal-form').addEventListener('submit', e => {
  e.preventDefault(); guarded(async () => { await api('/api/proposals', { userId: $('proposal-user').value, groupId: $('proposal-group').value }); $('proposal-dialog').close(); await navigate('proposals'); }, e.submitter);
});
$('chat-form').addEventListener('submit', e => {
  e.preventDefault(); if (state.busy) return;
  const text = $('message').value.trim(); if (!text) return;
  state.busy = true;
  guarded(async () => {
    const user = el('div', undefined, 'message user'); user.append(el('strong', 'VOCÊ'), document.createTextNode(text)); $('messages').append(user); $('message').value = '';
    try { const result = await api('/api/chat', { message: text }); const response = el('div', undefined, 'message'); response.append(el('strong', 'GODEYE'), document.createTextNode(result.text)); $('messages').append(response); await refreshProposals(); }
    finally { state.busy = false; }
  }, e.submitter);
});
guarded(initialize);
