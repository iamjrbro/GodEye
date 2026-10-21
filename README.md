# GodEye

Assistente web multitenant para consultar Microsoft 365 e preparar alterações com aprovação explícita. Cada organização conecta seu próprio tenant; os usuários acessam apenas os dados dessa organização.

**Status: MVP para piloto supervisionado, não uma plataforma de produção com cobertura completa.** A interface e os testes usam português. O código contém integração real com Microsoft Graph e autenticação Microsoft; sem credenciais você pode explorar a demonstração local. Exchange Online, administração de SharePoint e recursos Azure ainda não estão implementados.

## Executar em cinco minutos

Requisito: Node.js 24 LTS e npm.

```powershell
git clone https://github.com/iamjrbro/GodEye.git
cd GodEye
Copy-Item .env.example .env
npm ci
npm start
```

Abra [http://localhost:3000](http://localhost:3000). Escolha uma das duas empresas fictícias e um perfil. Crie uma proposta em **Aprovações → Nova alteração**, confira os objetos e aprove. Saia e entre na outra empresa para conferir o isolamento dos registros. O modo demo não se conecta à Microsoft e é bloqueado quando `NODE_ENV=production`.

Sem chave OpenAI, as abas de consulta e o formulário de propostas funcionam. O chat explica como habilitar a IA; não simula respostas de um modelo. Para habilitar, configure `OPENAI_API_KEY` e `OPENAI_MODEL` com um modelo disponível no seu projeto que suporte Responses API e function calling. A cobrança da API é separada da assinatura do ChatGPT.

## O que funciona

| Capacidade | Situação |
|---|---|
| Login Microsoft multitenant | Implementado; exige registro web e configuração |
| Empresas autorizadas | Lista explícita `ALLOWED_TENANT_IDS`, nega acesso por padrão |
| Consultas de usuários, grupos e SKUs de licença | Graph v1.0, até 100 registros por consulta |
| Chat em linguagem natural | Responses API opcional; consultas e criação de propostas |
| Adicionar usuário a grupo estático na nuvem | Proposta, aprovação, revalidação e execução delegada |
| Papéis leitor, operador e aprovador | Claims de app roles Microsoft, verificadas no servidor |
| Isolamento e auditoria por tenant | Sessão determina o tenant; payload não pode trocá-lo |
| Sessões e registros cifrados | AES-256-GCM, SQLite local persistente |
| Exchange / SharePoint admin / Azure ARM | Planejado; sem conectores de execução nesta versão |
| Distribuição como MCP | Planejado; esta versão entrega aplicação web própria |

## Como uma empresa conecta seu tenant

Você mantém um registro de aplicação **multitenant** no Entra da plataforma. Cada empresa autoriza o acesso desse aplicativo no próprio tenant e atribui papéis aos seus usuários. O operador da plataforma habilita o Tenant ID na lista de empresas autorizadas. Não é necessário distribuir suas credenciais de plataforma aos clientes.

Consentimento Microsoft e aprovação de uma alteração são controles diferentes: o primeiro concede capacidade de acesso; o segundo autoriza uma operação específica dentro do GodEye. O backend não oferece uma ferramenta de execução ao modelo de IA.

1. [Configuração Microsoft, permissões e onboarding](docs/MICROSOFT_SETUP.md).
2. [Implantação no Azure e persistência](docs/AZURE_DEPLOYMENT.md).
3. [Arquitetura, proteção de dados e limites](docs/ARCHITECTURE.md).
4. [Plano de evolução](docs/ROADMAP.md).

## Desenvolvimento

```powershell
npm run dev
npm run check
npm test
npm audit
```

Os testes usam dados e adaptadores locais; não fazem alterações Microsoft. Testam isolamento, RBAC, origem/CSRF, expiração, duplicidade, grupos restritos, criptografia e falhas de rede. Integrações reais requerem homologação em tenant de testes com credenciais próprias.

```text
src/                 Backend Express, OAuth, Graph, políticas e auditoria
public/              Interface sem etapa de build
test/                Testes de integração HTTP e políticas
docs/                Configuração e decisões de arquitetura
infra/               Template Azure Bicep e app roles de exemplo
.github/workflows/   Verificação automática no GitHub
```

## Limites do piloto

O servidor usa SQLite com uma única instância e volume persistente local. Não escale horizontalmente nem use SQLite em compartilhamento de rede. Para operação comercial com alta disponibilidade, migre registros e sessões para serviços gerenciados, implemente fila de execução e revise isolamento, retenção e operação antes do lançamento. O template Azure usa uma VM com Docker e volume local em disco gerenciado.

O chat trata cada mensagem independentemente; o histórico visual fica na aba do navegador. As listas não representam um inventário completo acima de 100 registros. Esta versão não oferece remoção de membros, criação de usuários nem execução arbitrária de PowerShell. Alterações com resultado incerto precisam de reconciliação manual no Entra e nunca são repetidas automaticamente.

## Contribuir e distribuir

Abra issues e pull requests. Não inclua tokens, `.env`, certificados, banco de dados ou informações de tenants reais. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md). Código distribuído sob [licença MIT](LICENSE).
