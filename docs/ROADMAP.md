# Evolução do GodEye

## Entrega 0.1: piloto

Aplicação web, demonstração local com dois tenants, login Microsoft delegado multitenant, leitura Graph, proposta de adição de membro, aprovação e auditoria. IA opcional. Instruções e infraestrutura para piloto em uma instância Azure.

## Próxima etapa: operação SaaS

- Onboarding de organizações com consentimento administrativo e aprovação do operador da plataforma.
- PostgreSQL, isolamento RLS, sessões compartilhadas e fila de jobs idempotentes.
- Paginação completa, busca de objetos e inventário com data de coleta.
- Histórico de chat por usuário/empresa com política de retenção e consentimento.
- Quotas, controles de custo e limites por tenant.
- Conciliação de resultados incertos, exportação de auditoria e recuperação de desastres.
- Gestão de usuários, sessões e políticas de aprovação, incluindo separação obrigatória entre solicitante e aprovador quando exigida pelo cliente.

## Conectores adicionais

- Exchange Online: worker PowerShell, autenticação e RBAC próprios, conjunto limitado de operações.
- SharePoint: operações Graph e administração de sites, permissões delimitadas por site quando possível.
- Azure: ARM com RBAC no escopo de assinatura/resource group, consentimento separado do Graph.
- MCP: reutilizar os serviços e políticas do backend para clientes compatíveis, sem expor execução genérica.

Cada conector deve ter contratos de leitura/escrita, menor privilégio, proposta revisável, validação de estado, auditoria e testes reais antes de aparecer como disponível.
