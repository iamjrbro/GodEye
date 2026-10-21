import { randomBytes } from 'node:crypto';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const mode = env.APP_MODE || 'demo';
  if (!['demo', 'microsoft'].includes(mode)) throw new Error('APP_MODE inválido');
  if (production && mode === 'demo') throw new Error('Modo demo proibido em produção');
  const appUrl = new URL(env.APP_URL || 'http://localhost:3000');
  if (production && appUrl.protocol !== 'https:') throw new Error('Produção exige APP_URL HTTPS');
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash) throw new Error('APP_URL deve conter apenas a origem');
  const tenants = (env.ALLOWED_TENANT_IDS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (tenants.some(x => !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x))) throw new Error('Tenant ID inválido');
  if (mode === 'microsoft' && (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !tenants.length)) {
    throw new Error('Configure credenciais Microsoft e ALLOWED_TENANT_IDS antes de conectar tenants');
  }
  if ((production || mode === 'microsoft') && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !/^[a-f0-9]{64}$/i.test(env.DATA_ENCRYPTION_KEY || ''))) {
    throw new Error('Configure SESSION_SECRET (32+ caracteres) e DATA_ENCRYPTION_KEY (64 hex)');
  }
  if (env.OPENAI_API_KEY && !env.OPENAI_MODEL) throw new Error('Configure OPENAI_MODEL');
  return {
    production, mode, origin: appUrl.origin, port: Number(env.PORT || 3000),
    databasePath: env.DATABASE_PATH || './data/godeye.sqlite',
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
    encryptionKey: env.DATA_ENCRYPTION_KEY || randomBytes(32).toString('hex'),
    clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET,
    tenants, writes: env.ENABLE_WRITES === 'true',
    openaiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL,
  };
}
