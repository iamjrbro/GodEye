import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, requireRole, assertWritableGroup, operationHash, assertApproval } from './policy.js';

export const proposalInput = z.object({ userId: z.uuid(), groupId: z.uuid() }).strict();
export function createOperations(store, graph, config) {
  return {
    async propose(req, input) {
      const actor = req.session.actor;
      requireRole(actor, 'GodEye.Operator');
      if (config.mode !== 'demo' && !config.writes) throw new AppError(403, 'Escrita desabilitada nesta instalação.');
      const { userId, groupId } = proposalInput.parse(input);
      const [user, group] = await Promise.all([graph.user(req, userId), graph.group(req, groupId)]);
      assertWritableGroup(group);
      const beforeMember = await graph.member(req, groupId, userId);
      if (beforeMember) throw new AppError(409, 'O usuário já pertence a este grupo.');
      const p = { id: randomUUID(), tenant: actor.tenant, action: 'group.addMember', user, group, beforeMember,
        requestedBy: actor.oid, requestedByName: actor.name, created: new Date().toISOString(), expires: Date.now() + 15 * 60_000,
        status: 'pending', impact: 'O usuário poderá receber os acessos concedidos por este grupo. Reversão: remover a associação após revisão no Microsoft Entra.' };
      p.hash = operationHash(p);
      store.insertProposal(p);
      store.log(actor, 'proposal.created', { proposalId: p.id, hash: p.hash, userId, groupId });
      return p;
    },
    async approve(req, id, hash) {
      const actor = req.session.actor, p = store.proposal(actor.tenant, id);
      assertApproval(p, actor);
      if (hash !== p.hash) throw new AppError(409, 'Confirmação não corresponde à proposta exibida.');
      if (config.mode !== 'demo' && (!config.writes || !req.session.writeConsent)) throw new AppError(403, 'Entre com consentimento de escrita antes de aprovar.');
      // Claim durável antes do primeiro efeito externo: nenhuma execução duplicada.
      if (!store.claim(actor.tenant, id)) throw new AppError(409, 'Proposta já processada ou expirada.');
      store.log(actor, 'proposal.approved', { proposalId: id, hash });
      let attempted = false;
      try {
        const [user, group] = await Promise.all([graph.user(req, p.user.id), graph.group(req, p.group.id)]);
        assertWritableGroup(group);
        if (user.displayName !== p.user.displayName || user.userPrincipalName !== p.user.userPrincipalName || group.displayName !== p.group.displayName || await graph.member(req, group.id, user.id)) {
          throw new AppError(409, 'O estado dos objetos mudou. Crie uma nova proposta.');
        }
        attempted = true;
        await graph.add(req, group.id, user.id);
        const verified = await graph.member(req, group.id, user.id);
        const status = verified ? 'succeeded' : 'pending_verification';
        store.status(actor.tenant, id, status);
        store.log(actor, `execution.${status}`, { proposalId: id, hash });
        return { status };
      } catch (e) {
        const status = attempted ? 'uncertain' : 'stale';
        store.status(actor.tenant, id, status);
        store.log(actor, `execution.${status}`, { proposalId: id, hash });
        throw new AppError(e.status || 502, attempted ? 'Resultado incerto. Não repita a alteração: confira a associação no Entra e a auditoria.' : e.message);
      }
    },
  };
}
