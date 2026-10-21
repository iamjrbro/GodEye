# Implantar piloto no Azure

Este caminho instala uma única instância em VM Ubuntu com Docker e Caddy/HTTPS. O volume Docker fica em disco local gerenciado da VM, apropriado ao SQLite deste MVP. Não monte Azure Files/NFS/SMB no diretório do banco e não execute múltiplas réplicas. A VM e o IP público geram custos; o repositório não implanta recursos automaticamente.

Pré-requisitos: assinatura Azure, permissão para criar recursos, Azure CLI/Bicep, chave pública SSH, domínio com controle de DNS, registro Microsoft configurado e portas 80/443 acessíveis para emissão TLS. Credenciais e domínio são fornecidos pelo responsável pela implantação.

## 1. Criar infraestrutura

No seu terminal, revise o template e substitua os exemplos:

```powershell
az login
az account set --subscription "SUA-ASSINATURA"
az group create --name rg-godeye-pilot --location brazilsouth
az bicep build --file infra/main.bicep
az deployment group what-if --resource-group rg-godeye-pilot --template-file infra/main.bicep --parameters sshPublicKey="SUA-CHAVE-PUBLICA-SSH" sshSourceCidr="SEU-IP-PUBLICO/32"
az deployment group create --resource-group rg-godeye-pilot --template-file infra/main.bicep --parameters sshPublicKey="SUA-CHAVE-PUBLICA-SSH" sshSourceCidr="SEU-IP-PUBLICO/32"
```

O tamanho padrão é `Standard_B2s`, ajustável por `vmSize` conforme disponibilidade e capacidade. O template cria VM, disco, rede e IP. Ele **não** instala a aplicação nem configura credenciais, DNS, backups ou Entra. `what-if` ajuda a revisar o impacto antes de criar recursos. Não use origem SSH `*` ou `0.0.0.0/0`.

## 2. Preparar o servidor

1. Crie um registro DNS **A** como `godeye.seudominio.com` para o IP retornado.
2. Conecte via SSH: `ssh godeyeadmin@IP-DA-VM`.
3. Instale Docker Engine e o plugin Docker Compose seguindo a [documentação oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Instale Git se necessário. Restrinja acesso ao daemon Docker a administradores confiáveis.
4. No servidor, clone o repositório e crie `.env` com permissão restrita:

```bash
git clone https://github.com/iamjrbro/GodEye.git
cd GodEye
umask 077
cp .env.example .env
```

Edite `.env` com um editor no servidor. Não coloque segredos em comandos que ficarão no histórico. Configure:

```dotenv
DOMAIN=godeye.seudominio.com
CADDY_EMAIL=administrador@seudominio.com
NODE_ENV=production
APP_MODE=microsoft
APP_URL=https://godeye.seudominio.com
MICROSOFT_CLIENT_ID=<application-id>
MICROSOFT_CLIENT_SECRET=<valor-do-segredo>
ALLOWED_TENANT_IDS=<tenant-id>
SESSION_SECRET=<valor-aleatorio-longo>
DATA_ENCRYPTION_KEY=<64-caracteres-hex>
ENABLE_WRITES=false
OPENAI_API_KEY=
OPENAI_MODEL=
```

O Compose impõe `NODE_ENV=production`, `APP_MODE=microsoft`, URL HTTPS baseada em `DOMAIN` e banco no volume `/app/data`. A aplicação recusa subir sem as configurações necessárias. Gere as duas chaves separadamente e mantenha backup seguro. Para piloto, `.env` deve ser legível somente por administradores; antes da operação comercial, integre um cofre de segredos e rotação.

## 3. Subir e validar

```bash
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=50 app proxy
```

Acesse `https://godeye.seudominio.com/healthz` e depois a raiz. O Caddy emite o certificado após DNS e conectividade corretos. A porta 3000 não é exposta publicamente. Não adicione outro proxy sem revisar `trust proxy` e o encaminhamento seguro de headers.

Adicione `https://godeye.seudominio.com/auth/callback` ao registro Web Microsoft. Execute o roteiro de homologação de [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md). Só depois habilite escrita em um grupo de laboratório e valide o fluxo completo. As funções Graph reais e a IA não são validadas pelos testes locais sem as credenciais.

## 4. Atualizações e backups

Atualize após revisar as mudanças:

```bash
git pull --ff-only
sudo docker compose up -d --build
```

Não rode `docker compose down -v`: isso remove volumes e os dados do piloto. O disco do SO é persistente e tem política de desanexação ao excluir a VM, mas remover o grupo de recursos remove os recursos nele. Configure Azure Backup para a VM, proteja a chave `DATA_ENCRYPTION_KEY` fora dela e teste restauração antes de aceitar dados reais. Para um snapshot consistente simples, pare o serviço da aplicação durante a cópia/snapshot do volume e reinicie-o depois. Não copie apenas o arquivo `.sqlite` enquanto WAL estiver ativo.

Ao migrar de SQLite, implemente um novo store transacional com PostgreSQL e sessões compartilhadas antes de adotar App Service/Container Apps com escala. O piloto não tem alta disponibilidade, restauração automática nem atualização sem interrupção.

## 5. GitHub Actions

O workflow de CI executa instalação pelo lockfile, verificação de sintaxe, testes, auditoria de dependências e compilação Bicep. Não implanta recursos, não usa credenciais Microsoft e não precisa de segredos para os testes. Para implantação contínua futura, prefira federação OIDC GitHub/Azure e ambiente protegido com aprovação; não publique credenciais de assinatura.
