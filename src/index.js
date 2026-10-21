import { createApp } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig(), { app, store } = createApp(config);
const server = app.listen(config.port, config.production ? '0.0.0.0' : '127.0.0.1');
server.on('listening', () => console.log(`GodEye: ${config.origin} (${config.mode})`));
server.on('error', error => { console.error(`Não foi possível iniciar o servidor: ${error.code}`); store.close(); process.exit(1); });
const cleanup = setInterval(() => store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()), 3600_000); cleanup.unref();
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
