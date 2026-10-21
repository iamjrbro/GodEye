# Configurar Microsoft Entra e Graph

Este guia descreve o registro da plataforma e o onboarding dos clientes na nuvem comercial Microsoft. Não é uma integração app-only: esta versão usa permissões **delegadas**, em nome da pessoa conectada. Nenhum cliente precisa fornecer sua senha ao GodEye.

## 1. Registro da plataforma

No Entra admin center do tenant que hospedará a plataforma:

1. Em **App registrations → New registration**, crie `GodEye`.
2. Selecione **Accounts in any organizational directory**. Não habilite contas pessoais Microsoft.
3. Adicione uma plataforma **Web** com redirect URI `http://localhost:3000/auth/callback` para desenvolvimento e `https://SEU-APP.azurewebsites.net/auth/callback` para o piloto publicado. Não habilite implicit grant nem public client flows.
4. Anote o **Application (client) ID**.
5. Crie um segredo de cliente com validade limitada em **Certificates & secrets**. Guarde o **valor** do segredo em armazenamento seguro. Nunca copie para o GitHub. Use registros distintos para desenvolvimento e produção.
6. Crie os app roles abaixo. O arquivo [infra/app-roles.json](../infra/app-roles.json) contém o array que pode ser incorporado ao campo `appRoles` do manifesto, preservando os demais campos do registro.

| Valor exato do papel | Uso |
|---|---|
| `GodEye.Reader` | Consultas e visualização de registros |
| `GodEye.Operator` | Consultas e criação de propostas |
| `GodEye.Approver` | Consultas, aprovação e rejeição de propostas |

Os papéis são independentes. Para propor e aprovar, atribua `GodEye.Operator` e `GodEye.Approver`. Todas as contas com um papel reconhecido podem consultar. Não existe promoção automática do primeiro usuário a administrador.

## 2. Permissões Graph delegadas

Adicione em **API permissions → Microsoft Graph → Delegated permissions**:

| Permissão | Finalidade |
|---|---|
| `User.Read` | Perfil da sessão |
| `User.Read.All` | Lista e detalhes de usuários |
| `Group.Read.All` | Grupos, propriedades e associação atual |
| `LicenseAssignment.Read.All` | Consulta de SKUs e consumo de licenças |
| `GroupMember.ReadWrite.All` | Opcional: adicionar membro após aprovação |

Conceda consentimento administrativo para as permissões que o piloto usará. A função do administrador que pode consentir depende das políticas e permissões solicitadas. Siga as políticas da organização.

Não adicione permissões de aplicação/app-only, `Directory.ReadWrite.All` nem permissões Exchange para este MVP. A aplicação não usa essas capacidades. `ENABLE_WRITES=false` bloqueia a escrita no backend mesmo que o consentimento Microsoft já exista.

## 3. Papéis e onboarding em cada empresa

1. O operador da plataforma adiciona o Tenant ID do cliente em `ALLOWED_TENANT_IDS` e reinicia a aplicação. Sem essa inclusão, o login é recusado.
2. Um administrador autorizado do cliente concede consentimento à aplicação multitenant. Pode usar um fluxo de consentimento administrativo tenant específico: `https://login.microsoftonline.com/TENANT-ID/v2.0/adminconsent?client_id=CLIENT-ID&redirect_uri=REDIRECT-URI-ENCODED&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default`.
3. Use um redirect URI já registrado. Este MVP não implementa onboarding automático pelo retorno desse consentimento: o callback da aplicação exige um fluxo de login com `state`, `nonce` e PKCE. Se o navegador retornar uma mensagem de login inválido após o consentimento administrativo, confirme o consentimento no Entra e inicie um login normal em `/auth/login`. O callback não habilita tenants por parâmetros de URL.
4. Em **Enterprise applications → GodEye → Properties**, habilite **Assignment required** conforme a política da empresa.
5. Em **Users and groups**, atribua os papéis GodEye aos usuários. Faça atribuição direta se a organização não tiver licença para atribuição por grupos.
6. O usuário abre o GodEye e entra com sua conta corporativa. O aplicativo verifica Tenant ID e os app roles retornados pelo login Microsoft.
7. Para aprovar alterações reais, habilite `ENABLE_WRITES=true`; o aprovador usa **Conexões → Entrar com consentimento de escrita** e completa o consentimento necessário. Esse login substitui a sessão anterior.

O papel GodEye não concede função administrativa Microsoft. O aprovador também precisa poder gerenciar a associação do grupo no Entra, conforme as permissões delegadas e a função/propriedade Microsoft aplicável. Não conceda Global Administrator apenas para usar o GodEye. Grupos atribuíveis a funções, dinâmicos, sincronizados e listas de distribuição são bloqueados nesta versão.

## 4. Variáveis locais

```dotenv
APP_MODE=microsoft
APP_URL=http://localhost:3000
MICROSOFT_CLIENT_ID=<application-id>
MICROSOFT_CLIENT_SECRET=<valor-do-segredo>
ALLOWED_TENANT_IDS=<tenant-id-empresa-a>,<tenant-id-empresa-b>
SESSION_SECRET=<valor-aleatorio-32-ou-mais-caracteres>
DATA_ENCRYPTION_KEY=<64-caracteres-hexadecimais>
ENABLE_WRITES=false
```

Gere cada segredo separadamente:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DATA_ENCRYPTION_KEY` protege sessões, cache MSAL, propostas e auditoria em repouso. Mantenha essa chave estável, protegida e com backup. Trocar a chave sem migrar os registros impede a leitura dos dados existentes. No modo demo sem chaves, uma chave temporária é gerada por processo: use chaves estáveis para manter dados entre reinícios.

## 5. Homologação real obrigatória

Em um tenant de testes: recuse usuário sem papel; recuse outro tenant; teste leitor, operador e aprovador; confira o consentimento delegado; crie um grupo estático de laboratório; proponha adicionar um usuário de teste; confira os IDs e aprove; verifique associação no Entra e trilha GodEye. Teste revogação e expiração da sessão. Não use grupos com acesso a dados sensíveis na homologação inicial.

Alterações de app roles no Entra só são refletidas em um novo login ou na renovação aplicável. Sessões GodEye têm duração de até oito horas; para revogação imediata no piloto, revogue sessões locais e o acesso Microsoft. Uma tela de gestão de sessões ainda não existe.

## Referências oficiais

- [Aplicativos single e multitenant](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- [Consentimento de aplicativo multitenant](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/create-service-principal-cross-tenant)
- [Aquisição de tokens no MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests)
- [App roles](https://learn.microsoft.com/en-us/graph/api/resources/approle)
- [Adicionar membro a grupo](https://learn.microsoft.com/en-us/graph/api/group-post-members)
