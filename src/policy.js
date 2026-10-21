import { createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireRole(actor, role) {
  if (!actor) throw new AppError(401, 'Entre para continuar.');
  if (!actor.roles.includes(role)) throw new AppError(403, `Seu usuário precisa do papel ${role}.`);
}
export function operationHash(p) {
  return createHash('sha256').update(JSON.stringify([p.tenant, p.action, p.user.id, p.group.id, p.beforeMember])).digest('hex');
}
export function assertWritableGroup(g) {
  if (g.isAssignableToRole !== false || g.onPremisesSyncEnabled === true || g.groupTypes?.includes('DynamicMembership') || (g.mailEnabled && !g.groupTypes?.includes('Unified'))) {
    throw new AppError(422, 'Esta versão aceita apenas grupos estáticos na nuvem, sem atribuição de funções e sem listas de distribuição.');
  }
}
export function assertApproval(p, actor, now = Date.now()) {
  requireRole(actor, 'GodEye.Approver');
  if (!p || p.tenant !== actor.tenant) throw new AppError(404, 'Proposta não encontrada.');
  if (p.status !== 'pending') throw new AppError(409, 'Esta proposta já foi processada.');
  if (p.expires <= now) throw new AppError(409, 'Proposta expirada. Crie outra.');
  if (p.hash !== operationHash(p)) throw new AppError(409, 'A proposta foi modificada.');
}
