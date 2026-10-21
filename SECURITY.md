# Segurança

Não abra issues públicas com credenciais, dados pessoais, nomes de clientes ou provas que exponham tenants reais. Use o recurso de relato privado de vulnerabilidades do GitHub, se estiver habilitado no repositório; se não estiver, peça ao mantenedor um canal privado sem descrever a falha publicamente.

Este projeto é um MVP para piloto supervisionado. Testes locais não substituem homologação de OAuth/Graph, avaliação de isolamento ou revisão de segurança antes de produção comercial. Leia [a arquitetura](docs/ARCHITECTURE.md) para conhecer os limites.

Se um segredo for publicado acidentalmente, revogue-o no provedor antes de limpar o histórico. Nunca envie tokens, arquivos `.env`, certificados ou bancos de produção em issues/PRs. Dependências devem ser revisadas com `npm audit` e atualizadas com testes.
