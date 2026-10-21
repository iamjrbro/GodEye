# Contribuir

Use Node.js 24. Instale com `npm ci`, execute `npm run check` e `npm test`. Para mudanças de dependências, atualize o lockfile e execute `npm audit`. Novas operações administrativas precisam de autorização no servidor, proposta revisável, expiração, tratamento de resultado incerto, isolamento por tenant e testes que demonstrem esses controles.

Abra um PR com problema, comportamento resultante, testes e limitações. Use apenas dados fictícios. Não inclua credenciais, bancos locais nem identidades reais. Não introduza endpoints de PowerShell/comandos arbitrários ou ferramentas de IA que dispensem a aprovação do servidor.

Mudanças de schema exigem estratégia de migração e restauração. Recursos planejados devem permanecer claramente identificados até terem implementação e homologação.
