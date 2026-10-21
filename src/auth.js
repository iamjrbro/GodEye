import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './policy.js';

export const readScopes = ['User.Read', 'User.Read.All', 'Group.Read.All', 'LicenseAssignment.Read.All'];
const writeScopes = [...readScopes, 'GroupMember.ReadWrite.All'];
const roles = ['GodEye.Reader', 'GodEye.Operator', 'GodEye.Approver'];
export const demoTenants = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Aurora Educação' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Horizonte Tecnologia' },
];
export function createAuth(config, store) {
  function client(cache) {
    const app = new ConfidentialClientApplication({ auth: {
      clientId: config.clientId, clientSecret: config.clientSecret,
      authority: 'https://login.microsoftonline.com/organizations',
    } });
    if (cache) app.getTokenCache().deserialize(cache);
    return app;
  }
  function equal(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
  return {
    async login(req, res) {
      if (config.mode === 'demo') return res.redirect('/');
      const app = client(), pkce = await new CryptoProvider().generatePkceCodes();
      const write = req.query.write === '1' && config.writes;
      req.session.oauth = { state: randomBytes(32).toString('hex'), nonce: randomBytes(32).toString('hex'), verifier: pkce.verifier, write, expires: Date.now() + 600_000 };
      const url = await app.getAuthCodeUrl({
        scopes: write ? writeScopes : readScopes, redirectUri: `${config.origin}/auth/callback`,
        state: req.session.oauth.state, nonce: req.session.oauth.nonce,
        codeChallenge: pkce.challenge, codeChallengeMethod: 'S256', prompt: 'select_account',
      });
      req.session.save(err => { if (err) return res.status(500).send('Falha ao iniciar login.'); res.redirect(url); });
    },
    async callback(req, res) {
      const pending = req.session.oauth;
      delete req.session.oauth;
      await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
      if (!pending || pending.expires < Date.now() || !equal(req.query.state, pending.state) || typeof req.query.code !== 'string') throw new AppError(400, 'Login inválido ou expirado. Inicie novamente.');
      const app = client();
      const result = await app.acquireTokenByCode({ code: req.query.code, scopes: pending.write ? writeScopes : readScopes,
        redirectUri: `${config.origin}/auth/callback`, codeVerifier: pending.verifier });
      const claims = result?.idTokenClaims;
      if (!claims || !equal(claims.nonce, pending.nonce) || !claims.oid || !claims.tid || claims.tid !== result.account?.tenantId || !config.tenants.includes(claims.tid.toLowerCase())) throw new AppError(403, 'Tenant não habilitado ou identidade inválida.');
      const assigned = (claims.roles || []).filter(x => roles.includes(x));
      if (!assigned.length) throw new AppError(403, 'Peça ao administrador para atribuir um papel GodEye ao seu usuário.');
      await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
      req.session.actor = { tenant: claims.tid.toLowerCase(), tenantName: claims.tid, oid: claims.oid, name: claims.name || result.account.username, roles: assigned };
      req.session.account = result.account;
      req.session.cache = app.getTokenCache().serialize();
      req.session.writeConsent = pending.write;
      store.log(req.session.actor, 'session.login');
      req.session.save(err => { if (err) return res.status(500).send('Falha ao salvar login.'); res.redirect('/'); });
    },
    async token(req, write = false) {
      if (!req.session.actor) throw new AppError(401, 'Entre para continuar.');
      if (write && (!config.writes || !req.session.writeConsent)) throw new AppError(403, 'Habilite escrita e entre novamente com consentimento de escrita.');
      const app = client(req.session.cache);
      let result;
      try { result = await app.acquireTokenSilent({ account: req.session.account, scopes: write ? writeScopes : readScopes }); }
      catch { throw new AppError(401, 'Sua sessão Microsoft precisa de um novo login.'); }
      req.session.cache = app.getTokenCache().serialize();
      if (result.account?.tenantId.toLowerCase() !== req.session.actor.tenant) throw new AppError(403, 'Token pertence a outro tenant.');
      return result.accessToken;
    },
  };
}
