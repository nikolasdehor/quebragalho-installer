# Instalador Quebra-galho

Instala `quebragalho` em `~/.local/bin` para abrir diferentes harnesses com modelos de um gateway. Inspirado em `ollama launch`, sem copiar seu código. Requer macOS/Linux, Node.js 22+ e os harnesses desejados instalados.

```sh
git clone https://github.com/nikolasdehor/quebragalho-installer.git
cd quebragalho-installer
sh install.sh
export QUEBRAGALHO_BASE_URL="https://SEU-GATEWAY"
# Defina QUEBRAGALHO_API_KEY no ambiente com sua chave.
quebragalho list
quebragalho launch
quebragalho launch claude
quebragalho launch codex
quebragalho launch opencode
quebragalho launch aider
quebragalho launch pi
quebragalho launch codex --model ID -- exec "Explique este projeto"
quebragalho launch claude --model ID -- -p "Explique este projeto"
```

`launch` sem nome oferece escolha interativa de harness. O catálogo vem de `GET /v1/models` no formato `{"data":[{"id":"modelo"}]}`. A URL base deve ser a raiz, sem `/v1`. Com vários modelos, o launcher oferece seleção; sem terminal interativo, exige `--model`. Argumentos depois de `--` seguem literalmente para o harness. O código de saída e os sinais de encerramento são preservados.

| Harness | Configuração na sessão | API exigida | Catálogo dentro do harness |
| --- | --- | --- | --- |
| Claude Code | Variáveis Anthropic | /v1/messages, SSE e ferramentas | Descoberta nativa em /model nas versões compatíveis |
| Codex | Provider via -c, chave por ambiente | /v1/responses, SSE e ferramentas | Seleção pelo launcher; não injeta o picker nativo |
| OpenCode | Provider com catálogo via OPENCODE_CONFIG_CONTENT | /v1/chat/completions, SSE e ferramentas | Modelos em /models |
| Aider | OPENAI_API_BASE e modelo openai/ID | /v1/chat/completions | Seleção pelo launcher; não injeta o picker nativo |
| Pi | Extensão temporária com provider e catálogo | /v1/chat/completions, SSE e ferramentas | Modelos em /model |

O launcher não traduz protocolos. Catálogo disponível não comprova suporte a ferramentas ou a cada API; validar isso no gateway. Para Pi, os limites são conservadores (32K contexto, 4096 saída), entrada só texto e sem raciocínio declarado. Custos zero são placeholders do SDK, não indicação de gratuidade; não use a estimativa do Pi para faturamento. Substituir por metadados oficiais antes de distribuir em produção.

Não grava chaves nem edita configs globais dos harnesses ou arquivos do shell. Configs existentes continuam carregadas e podem interferir, especialmente políticas gerenciadas; confira o provider e modelo na sessão. OpenCode preserva campos existentes no JSON inline e acrescenta o provider. A extensão privada temporária do Pi é removida em saída normal, falha de execução e SIGINT/SIGTERM; SIGKILL ou queda da máquina podem deixar o arquivo, que não contém chave.

O tráfego da sessão vai para o gateway selecionado. O instalador não usa sudo, preserva executáveis existentes e não baixa harnesses automaticamente. `QUEBRAGALHO_BIN_DIR` escolhe outro destino; se ele não estiver no PATH, o instalador avisa.

## Verificação

```sh
npm test
node --check quebragalho.mjs
sh -n install.sh
```

Os testes executam o instalador, o launcher instalado e cinco executáveis simulados. Mockam a consulta HTTP para não abrir sockets nem usar credenciais reais. Verificam configs, catálogo, argumentos literais, códigos de saída, sinais, limpeza e erros. Não comprovam inferência, streaming ou ferramentas nos serviços reais.

Validação real em 30/09/2026, com credenciais somente no ambiente do processo e diretórios temporários:

- `npm test`, `node --check` e `sh -n`: verdes; instalação temporária e comando `list` conferidos.
- Gateway `https://api.quebragalho.dev`: catálogo HTTP 200, com 17 modelos.
- Messages e Chat Completions: HTTP 200 e resposta `OK` com `gpt-6-luna`.
- Responses: HTTP 404. O gateway testado não confirmou compatibilidade com Codex; o launcher exige esse protocolo e não o traduz.
- Claude Code 2.1.286: `launch` com `gpt-6-luna` respondeu `OK` e saiu com código zero; houve aviso de modelo desconhecido/limites de contexto. Com `claude-opus-5.5`, a tentativa foi encerrada após 150 segundos sem resposta.
- Codex 0.159.2: `launch` selecionou o provider e modelo corretos, mas saiu com código 1 após HTTP 404 em `/v1/responses`.
- OpenCode 1.18.31: `launch` com `gpt-6-luna` respondeu `OK` e saiu com código zero.
- Aider e Pi: integrações verificadas por testes locais com executáveis simulados; binários não testados ao vivo.

O repositório distribui o installer por clone; não há pacote npm ou release. Geração curta não comprova ferramentas, todos os modelos ou todos os recursos de streaming.

Referências: [Ollama](https://docs.ollama.com/integrations/claude-code), [Claude Code](https://code.claude.com/docs/en/model-config#add-a-custom-model-option), [Codex](https://learn.chatgpt.com/docs/config-file/config-advanced), [OpenCode](https://opencode.ai/docs/providers/#custom-provider), [Aider](https://aider.chat/docs/llms/openai-compat.html), [Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md).

