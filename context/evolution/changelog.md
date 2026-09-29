# Changelog

Uma entrada por mudança mergeada, da mais nova para a mais antiga, escrita no passo Learn da branch que fez a mudança. O formato está no [guia do Context Mesh](../README.md). O que veio antes do loop (de `0c8e760` a `fb4a804`) está na entrada retroativa do fim, escrita pela #4.

---

## 2026-09-29: Os geradores formatam em memória, com a config do caminho de destino, antes de tocar na saída (#29)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **O formatador `scripts/format-generated.mjs`.** Ele recebe a lista de `{ path, content }` no stdin e formata cada texto pela API do Prettier, com a config do caminho de destino (`resolveConfig` com `editorconfig: true`) e com o `requirePragma` e o range forçados. Ele importa o Prettier de `<raiz>/node_modules/prettier/index.mjs` pelo caminho.
- **Os geradores formatam tudo antes de tocar em qualquer pasta.** Cada gerador monta um `Output` por pasta de saída e chama o `write_or_check_outputs()` uma vez. O `format_files()` formata a execução inteira numa chamada, e só então o `write_outputs()` recusa, apaga e grava, ou o `check_outputs()` compara.
- **Saiu o caminho do CLI:** o `format_with_prettier()`, a conferência do relatório por arquivo, a limpeza das variáveis `PRETTIER_*`, o `.codegen-tmp` e a linha dele no `.gitignore`.
- **A ADR 0015** substitui a 0011 e mantém dela o que valia: nenhum arquivo de ignore alcança a saída, o `requirePragma` e o range forçados, a saída 2 e a busca do node. As ADRs 0004, 0008, 0009 e 0012, os dois patterns do código gerado e três anti-patterns dizem o mecanismo novo, e as citações do CLI levam o commit `d50fd00`.
- **Da verificação adversarial** (`814573a`):
  - o `--check` lê as quebras de linha do texto formatado como o `read_text()` lê as do arquivo. Com `endOfLine: crlf` ou `cr`, ele saía com 1, uma regressão frente ao CLI;
  - o `write_outputs()` codifica tudo em UTF-8 antes do primeiro `rmtree`;
  - o formatador manda o `console.log` para o stderr;
  - o `prettier_environment()` confere o próprio formatador.

### Números medidos

- **Antes**, sobre `d50fd00`:
  - com um `overrides` para `src/**`, um `src/.prettierrc` ou um `src/.editorconfig`, gerar saía com 0, o `--check` com 1 e o `format:check` com 0;
  - com um `.prettierrc` inválido, o `definitions` e o `resources` deixavam 3 arquivos cada regravados sem formatação;
  - com o `.prettierrc` inválido só em `src/user-management/`, os três geradores mudavam 13, 3 e 6 arquivos dessa área.
- **Depois**: os três saem com 0 nas três configs, e as falhas saem com 2 sem mudar nenhum arquivo de `src/`.
- **Tempo**: o `generate:all` caiu de 10,4 s para 4,1 s e o `check:all` de 9,9 s para 3,8 s, com `src/` reescrito byte a byte e as 16 linhas "are current".
- **`npm run check`**: 3.826 testes em 22 arquivos antes deste Learn, e 3.827 com o caso que o `drift.spec.ts` gera para o anti-pattern novo. O `codegen.spec.ts` foi de 71 para 80 casos. Entraram 17 casos da #29, 14 deles vermelhos antes da correção. Saíram os 6 do Prettier embrulhado, e os 3 de "not executable" e os 2 de "undo the rewrite" foram reescritos. O e2e ficou com 39.
- **Depois do merge da #24** (`2b48487`): 3.834 testes em 23 arquivos e o e2e com 447. Com a carga média entre 17 e 22, 82 casos dos hooks, do gate e um do `codegen.spec.ts` estouraram o tempo, e o do `codegen.spec.ts` saiu com `status` `null`, o processo morto pelo timeout. Rodados um arquivo de cada vez, os 8 arquivos passaram com os 1.903 casos. As três configs e as falhas deram o mesmo resultado.
- **A verificação adversarial**:
  - comparou o CLI e a API em 15 configs, com a saída de gerar igual byte a byte;
  - matou 6 mutações e achou 2 que passavam: o `import` pelo nome e a recusa no laço do `rmtree`;
  - o `codegen.spec.ts` ganhou 10 casos e foi a 90, 7 deles vermelhos no código de antes da correção.

### Decisões tomadas

- [0015: Os geradores formatam em memória, com a config do caminho de destino, antes de tocar na saída](../decisions/0015-generators-format-in-memory-at-the-destination-path.md), nova, com a resposta do dono à pergunta 1: a API do Prettier, não o CLI com pasta temporária.
- [0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](../decisions/0011-generators-format-without-ignore-files.md), agora `Superseded`.

### Patterns aplicados ou criados

- [Formatar uma cópia noutro caminho que o do destino](../knowledge/anti-patterns/formatting-a-copy-at-another-path.md), anti-pattern novo
- [Gerar e conferir](../knowledge/patterns/generate-and-check.md) e [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md), atualizados; a regra "Não ponha uma config do Prettier que dependa do caminho" saiu
- [Confiar que a ferramenta processou o arquivo passado pelo nome](../knowledge/anti-patterns/trusting-a-tool-to-process-a-named-file.md), com a API como a saída que a #29 escolheu
- [Timeouts de testes que disparam processos](../knowledge/patterns/process-test-timeouts.md), aplicado nos casos novos

### Aprendizados / surpresas

- **A alternativa óbvia só mudava o vermelho de lugar.** Formatar os dois modos na mesma pasta temporária fazia gerar concordar com o `--check`, mas não com o `format:check`, que lê a config do destino. Só a medição com as três configs mostrou isso.
- **A resolução do Node sobe de pasta.** Um `import('prettier')` sem `node_modules` na raiz achou o de uma pasta acima. Num worktree sem `npm ci`, os geradores formatariam com o Prettier do checkout principal.
- **Tirar uma linha de um módulo muito citado custa caro.** O contexto cita o `marketo_codegen.py` e os três geradores por linha em dezenas de lugares. Pôr o `FORMATTER` na linha do `TEMP` e trocar dois imports por dois manteve essas citações no lugar, como a #19 já tinha feito com o `document_path()`.
- **O protótipo pagou o plano.** A cópia fora do git mediu a paridade dos 1.088 arquivos e os tempos antes do Approve, e o Build só confirmou.
- **Com o HEAD destacado, o hook nega o `git checkout` de restauração.** Na medição do plano, a árvore voltou regerando com a config original.
- **Trocar um lado de uma comparação muda o que ela tolera.** O código antigo lia os dois lados com `read_text()`, e a tolerância a CRLF vinha de graça. O novo lia um lado da memória, e as quebras de linha passaram a contar. Nenhum teste tinha uma config com `crlf`, e só a verificação adversarial viu.
- **Um merge de `main` desloca de novo as citações que acabaram de ser acertadas.** O `is_type_alias()` da #24 somou 15 linhas no meio do módulo, e duas citações que coincidiam nos dois lados escaparam da resolução dos conflitos. Um script que imprime o código de cada citação `arquivo:linha` as achou.

---

## 2026-09-29: A auditoria de main nomeia o check em andamento no merge, e o fluxo pede nenhum no merge (#48)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **O motivo novo da auditoria.** Um merge cuja run mais nova de um check exigido começou antes dele e não tinha concluído nele continua fora do loop, agora com `PR #P mergeada com <workflow / job> em andamento; a última run concluída antes do merge: <conclusão | nenhuma>`. Até aqui, ele saía como `mergeada sem … verde`, o motivo de um check vermelho. O `greenAtMerge` de `scripts/audit-main.mjs` virou `checkAtMerge`.
- **O fluxo pede nenhum check em andamento no merge**, também no merge feito à mão: `gh pr checks <n>` sem nenhum `pending`. O hook de `gh pr merge` já negava o caso para o agente desde a #5. A triagem da auditoria diz como ler o motivo novo.
- **A ADR 0002** lista o motivo novo, e o `drift.spec.ts` confere que o fluxo e a ADR citam os dois motivos dos checks como a auditoria os escreve.
- **Um anti-pattern novo**, [Mergear com uma re-execução do check em andamento](../knowledge/anti-patterns/merge-with-a-run-in-flight.md), com o merge da PR #43 como caso.

### Números medidos

- **O caso da #43**, conferido no GitHub: tentativas 1 e 2 da run 36407495291 verdes às 10:04:59 e às 10:05:27, merge às 10:05:51, tentativa 3 começada às 10:05:42 e vermelha às 10:05:59 com `issue-open: #35 está fechada`.
- **Os testes**: 5 casos novos em `required checks` falharam antes da correção; depois, os 188 do `audit-main.spec.ts` e os 206 do `drift.spec.ts` passam. Quatro mutações da correção, numa cópia fora do git, foram pegas.
- **`npm run check`**: 3.831 testes em 23 arquivos; o e2e com 447, em 6 arquivos. Na primeira rodada, com a média de carga entre 18 e 19, 41 testes ficaram vermelhos em `test/hooks/` e em `test/scripts/gate.spec.ts`, por `git` estourando o prazo dentro dos hooks e 19 testes com 120 s. Rodado de novo com a carga mais baixa, o `gate.spec.ts` passou inteiro (365). O lint, o `format:check`, o typecheck, o `check:context`, o build e o `check:all` passaram. A prova da cadeia inteira é o `Qualidade / check` da PR.

### Decisões tomadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): o motivo novo, com o merge em andamento ainda fora do loop.
- As respostas do Approve da #48: manter a regra e nomear o caso, em vez de julgar pela última run concluída como o relato pedia; pôr no motivo a última conclusão antes do merge; e criar o anti-pattern.

### Patterns aplicados ou criados

- [Mergear com uma re-execução do check em andamento](../knowledge/anti-patterns/merge-with-a-run-in-flight.md), anti-pattern novo
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md): HIGH, porque a PR mexe na auditoria de `main` e nos testes do harness

### Aprendizados / surpresas

- **A causa do relato não se confirmou.** A #48 dizia que a auditoria lia o check como ele estava na hora de auditar. O código já julgava pelo horário do merge, e um teste já fixava que uma run em andamento no merge conta como não verde. O defeito era só o motivo, que não separava esse caso de um vermelho. Ler o código antes de planejar evitou afrouxar uma regra que estava certa.
- **O Build do harness precisou do dono presente.** No modo automático, o hook negou a edição de `scripts/audit-main.mjs`; fora dele, cada edição passou pela confirmação do dono. As mutações rodaram numa cópia fora do git, para não escrever no harness pelo shell.

---

## 2026-09-28: O código gerado segue o schema documentado, e um upload multipart chega ao handler (#24)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **Array de topo.** Uma definição de topo sem membros vira alias de tipo: `LeadAttribute2SearchableFields` é `Array<string>`, e `Person` e `CustomObject` são `Record<string, unknown>`. A factory do array devolve o valor inteiro, e `describe2.json` e `programs/members/describe.json` respondem `searchableFields` como array de arrays de string.
- **Resposta string.** Uma resposta 2xx primitiva ganha um valor do faker e sai como JSON, e `invite.json` responde 200 com uma string JSON.
- **Headers.** O controller envia os headers que a resposta 2xx declara, e os 7 POSTs de Data Ingestion respondem 202 com um `X-Request-Id` do `mockRequestId()`.
- **Multipart.** O `MultipartInterceptor`, escrito à mão em `src/multipart/`, lê o corpo com o `multer().any()` e põe cada parte em `req.body`. As 11 operações `multipart/form-data` recebem as partes pelo `@Body()` gerado, sem mudar o gerador, e um corpo malformado responde 400.
- **Três testes novos.** O `test/response-schema.e2e-spec.ts` confere as 388 operações contra o 2xx documentado: o status, o corpo contra o schema, com toda propriedade declarada, e os headers. As 10 contradições do próprio documento ficam numa lista nomeada. O `test/multipart.e2e-spec.ts` acha as operações multipart pelo documento e confere que cada parte chega ao service. O `test/type-aliases.spec.ts` guarda os aliases com `@ts-expect-error`.

### Números medidos

- **Antes**, na cabeça dos testes (`9a37fc7`): 10 de 390 linhas da conformidade e 10 de 15 do multipart falharam.
- **A saída**: 11 arquivos gerados mudaram, e um segundo `npm run generate:all` não mudou nenhum.
- **Depois**: o e2e passa com 441 testes em 5 arquivos. Dos 3.751 testes unitários, 11 falharam por tempo na primeira rodada, com média de carga entre 22 e 25, e passaram quando os 3 arquivos (1.033 testes) rodaram de novo. `check:context`, `build` e `check:all` passam.
- **As citações**: 103 citações de `context/` seguiram as linhas novas por um remapeamento pelo diff, e 6 foram refeitas à mão.
- **A verificação adversarial**: 388 operações em 6 variantes, contra a base e a cabeça. Ela achou 3 pontos a corrigir e 6 nits, e todos os 3 entraram na PR.

### Decisões tomadas

- [0013: Definição de topo sem membros vira alias de tipo, e a factory dela devolve o valor inteiro](../decisions/0013-top-level-definitions-without-members-as-type-aliases.md): emenda as ADRs 0006 e 0007.
- [0014: O corpo multipart lido num interceptor escrito à mão](../decisions/0014-multipart-read-by-a-hand-written-interceptor.md): aplica a ADR 0009 ao transporte, que continua `Proposed`.
- As cinco respostas do Approve da #24, todas com a recomendação: o parser escrito à mão, o `mockRequestId()` no header, nenhum limite de upload, `Person` e `CustomObject` incluídos e uma PR só. No Build, o dono trocou o middleware do plano pelo interceptor.

### Patterns aplicados ou criados

- [Middleware do Nest para todas as rotas, que vira uma rota](../knowledge/anti-patterns/nest-middleware-as-a-catch-all-route.md), anti-pattern novo
- [Uma porta efêmera nova a cada requisição do supertest](../knowledge/anti-patterns/a-new-ephemeral-port-per-supertest-request.md), anti-pattern novo
- [A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md) e [Factory com overrides](../knowledge/patterns/factory-with-overrides.md), atualizados
- [Gerar e conferir](../knowledge/patterns/generate-and-check.md): a saída regenerada num commit só dela

### Aprendizados / surpresas

- **Conferir a forma da resposta achou o que conferir a rota não achava.** O e2e da #6 via uma rota para cada operação, e o da #8, cada requisição no próprio handler. Só ler o corpo contra o schema mostrou o array vazio, a string sem corpo e o header ausente.
- **Um middleware do Nest para todas as rotas é uma rota do Express.** Os e2e do roteador da #6 e da #8 o pegaram na hora. Rodando o app, nada mudava.
- **Uma falha intermitente num teste de muitas requisições pode vir de outro processo.** O `403 text/plain`, que o app não sabe dar, apontou para o supertest, não para o seed: ele escuta no curinga e conecta em `127.0.0.1`, onde, no macOS, outro processo na mesma porta responde no lugar do app. O mecanismo foi provado, e a origem daquele `403`, inferida.
- **O plano publicado no mesmo comando que outra consulta não tirou o marcador do `plan-to-issue`.** O hook só aceita um `gh issue comment` sozinho na linha. Publicar de novo cancelaria o Approve, e o dono apagou o marcador à mão.
- **Um `npm install <pacote>` sem versão sobe a versão do lockfile.** Para usar direto uma dependência transitiva, declare a versão que o lockfile já tem.
- **Um e2e que só confere a resposta não guarda um tipo.** Com o gerador de aliases revertido, os dois testes novos e o `check:all` passavam, porque `string[]` cabe em `{}`. Um `@ts-expect-error` num teste é o que faz o `tsc` notar.
- **Um envelope sem `required` aceita `{}`.** Conferir só as propriedades obrigatórias deixava passar uma factory vazia em 236 das 379 respostas com corpo.
- **Os testes dos hooks e do gate falham por tempo com a máquina carregada**, como a #30 já registrou. Com a carga acima de 20, 11 falharam, e a nova rodada dos mesmos arquivos passou.

---

## 2026-09-28: Todo spec que dispara processos espera mais que o processo filho, e um guarda confere (#23)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **O guarda `test/test-timeouts.spec.ts`.** Ele lê cada `*.spec.ts` de `test/` e `src/` como texto e trata como disparador o spec que importa `node:child_process` ou um export de `test/support/` cujo corpo dispara processos. Um spec assim precisa declarar `vi.setConfig({ testTimeout })` maior que todo timeout de processo dele e dos exports que usa, e cada recusa cita `arquivo:linha` do caso e do processo.
- **Os dois specs com o descompasso.** `refresh-issue-link.spec.ts` dava ao caso os mesmos 60 s do processo e passou a 120 s. `loop-sections.spec.ts` rodava um `sh` sem timeout num caso de 5 s e passou a 30 s no processo e 60 s no caso. O caso do relato, em `check-context.spec.ts`, já tinha sido corrigido pela #34.
- **Da revisão do Copilot na PR #61, todo processo tem o próprio timeout.** O guarda passou a achar cada chamada de processo e a exigir o `timeout` dela, nos specs e em `test/support/`. Ele também passou a ler os imports por alias, a somar os repetidos e a deixar de fora os de tipo. As 15 chamadas sem timeout dos specs e as 4 dos helpers ganharam um.
- **Da segunda revisão, o guarda lê o código com o parser do TypeScript.** Por regex, ele deixava passar uma chamada no `${…}` de um template, um `vi.setConfig` comentado, um import de namespace e um timeout de helper que não resolve. Pelo parser, o repasse do timeout é conferido por chamada, e um timeout que não resolve é recusado.
- **Da terceira revisão, o guarda fecha a classe, e não só os casos.** Ele passou a resolver os nomes pela ligação, os spreads na ordem, os módulos carregados na chamada e os namespaces entre helpers, e a aceitar só o `vi.setConfig` do topo. Uma função de processo usada fora de uma chamada direta passou a ser recusada, e o pattern lista o que o guarda não segue.
- **Da quarta revisão:**
  - o ponto fixo do guarda termina com helpers que se chamam;
  - um timeout dado a um helper que tem o próprio entra na conta;
  - vale o último `vi.setConfig`;
  - os helpers JavaScript são lidos;
  - o `rev-parse` do `HookRepo`, que ganhou timeout, confere o status.
- **Da quinta revisão, os nomes resolvem pelo binder do TypeScript.** Um nome vale o que ele liga no escopo léxico do uso, e não mais o que qualquer declaração com a mesma grafia no arquivo liga.
- **Da sexta revisão:**
  - as funções privadas dos helpers são analisadas;
  - o alias de toda função que dispara processo é recusado;
  - os specs de `src/` são lidos;
  - só o `vi` do vitest conta.
- **Da sétima revisão:**
  - o `vi.setConfig` é lido na ordem, com spreads;
  - as opções de helper são lidas por `const` e por ternário;
  - os helpers são registrados pelos nomes de export, default e re-export.
- **Da oitava revisão, o ternário guarda cada ramo.** O timeout de uma chamada guarda todo valor, se algum ramo repassa o de quem chama e se algum não dá nenhum. O default export anônimo de um helper é lido.
- **Da nona revisão, a classe exportada como default também é lida.**
- **Da décima revisão:**
  - o `require` do topo de um helper é lido;
  - num spec, o timeout tirado de um parâmetro não é lido;
  - o spec vira disparador pelo uso como valor, e não pelo import.
- **Da décima primeira revisão, cada processo é comparado com o caso ou hook em que roda.** Isso inclui o timeout próprio de um `it`/`test`, o de um hook e o `hookTimeout`, que no vitest é de 10 s. Só o próprio timeout de quem chama conta como repasse.
- **Da décima segunda revisão:**
  - uma função do arquivo é seguida até cada caso ou hook que a nomeia ou chama;
  - quatro chamadas com timeout novo conferem o `status` antes de usar a saída.
- **Da décima terceira revisão:**
  - as opções de um caso são lidas na ordem;
  - o vitest é reconhecido por namespace;
  - um namespace re-exportado é recusado;
  - o `realGit` confere o `status`.
- **Da décima quarta revisão, a fixture em tupla é lida,** e uma função é seguida por alias e por método de objeto.
- **A regra virou pattern:** [Timeouts de testes que disparam processos](../knowledge/patterns/process-test-timeouts.md).

### Números medidos

- **O guarda**, em `e5b013c`, recusou exatamente os dois specs, e passa depois da correção. Com o `testTimeout` do `check-context.spec.ts` baixado para 30 s, ele recusa o arquivo citando os dois processos de 30 s.
- **Sob carga**, em `37864d8`, com uma rodada sozinha e cinco de duas `npx vitest run` ao mesmo tempo, as 11 rodadas de 3.754 testes somaram 625 falhas, de 8 (sozinha) a 162 por rodada. Nenhuma veio de um caso com timeout menor ou igual ao do processo que ele espera. São 488 respostas de hook que mudam sob carga, 110 casos acima de 120 s e 27 processos mortos pelo próprio timeout antes do caso.
- **Depois da quarta revisão**, `vitest run` em `be26d7e` deu 3.792 de 3.792, com load average perto de 12.
- **Depois da primeira revisão**, `vitest run` em `64ff029` deu 3.774 de 3.779, com os 12 casos do guarda. As 5 falhas, em `guard-bash`, `plan-to-issue` e `session-context`, foram o `git` de 10 s da lib dos hooks com `ETIMEDOUT` e load average perto de 18, a classe da #59. Os três arquivos rodados juntos passam com 689 de 689.
- **`npm run check`**, depois do merge de `main` (#19 e #20): 3.774 testes em 22 arquivos, com os 7 do guarda. Houve 1 falha, em `plan-to-issue.spec.ts:617`, pelo `git` de 10 s da lib dos hooks com `ETIMEDOUT` e load average perto de 18, a classe da #59. O arquivo passa isolado (145 de 145), e o `check:context`, o build e o `check:all` passam. O e2e passa com 33.

### Decisões tomadas

- As três respostas do Approve da #23: o critério "sem nenhum timeout sob carga" trocado por "nenhuma falha de um caso que espera menos que o processo", com a carga indo para a #59; o guarda por spec no lugar de um `testTimeout` global; e o pattern novo.

### Patterns aplicados ou criados

- [Timeouts de testes que disparam processos](../knowledge/patterns/process-test-timeouts.md), pattern novo

### Aprendizados / surpresas

- **O relato mediu o sintoma, não a causa.** A medição do plano mostrou que o descompasso da #23 não derrubava nenhum caso. Quem falha sob carga são os prazos de produção dos hooks e casos que somam dezenas de processos. Dar mais tempo aos testes não resolveria o critério do relato, e o escopo foi para a #59.
- **Uma worktree nova nasce sem `node_modules`.** O vitest roda pelo `node_modules` do checkout principal, mas o `codegen.spec.ts` procura o Prettier na própria árvore e deu 46 falhas falsas. Rode `npm ci` antes de medir.
- **Medir numa worktree separada.** Specs como o `check-context` leem `context/` ao vivo. Uma medição de uma hora na worktree da branch quebraria enquanto o Learn é escrito, então ela rodou numa worktree destacada no commit da correção.
- **Um guarda que lê código por regex vira uma corrida contra o revisor.** Cada rodada da revisão achou uma forma válida de TypeScript que o regex não lia. O parser do compilador, que já estava instalado, fechou todas de uma vez. Com o parser, a terceira rodada ainda achou caminhos de indireção. O que encerrou a corrida foi recusar o que o guarda não segue, em vez de tentar seguir cada forma, e registrar os limites.
- **O timeout do caso não encerra um processo.** A primeira versão do pattern dizia que um processo sem timeout seria encerrado pelo timeout do caso, e a revisão do Copilot mostrou que não é assim: o vitest só abandona o caso, e um `spawnSync` bloqueia o timer. O guarda que só compara números deixava passar exatamente o processo que trava.
- **O `guard-bash` recusa a troca de label no mesmo comando do comentário `# Plano`.** Ela só vale depois de o comentário existir, então vão em dois comandos.

---

## 2026-09-28: O mock aceita corpos até 1 MB, como o Marketo, e um lote de 300 leads cabe (#25)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **`src/body-limit.ts`**, escrito à mão, exporta `bodyLimit = '1mb'` e `useBodyLimit(app)`, que registra o parser JSON e o urlencoded com esse limite pelo `app.useBodyParser`. O urlencoded leva `extended: true`, como o padrão do Nest.
- **O `src/main.ts`** cria o app como `NestExpressApplication` e chama `useBodyLimit(app)` antes do Swagger e do `listen`. O e2e novo chama a mesma função antes do `init()`.
- **`test/body-limit.e2e-spec.ts`**, com 6 casos: os tamanhos dos corpos, 300 leads em `leads.json` (200), os mesmos 300 em `persons` (202), um form de 101 KiB em `email/:id/content.json` lido inteiro e com `nested[key]` como objeto, e o 413 acima de 1 MiB no JSON e no form. `test/runtime-defaults.spec.ts` ganhou 2 casos: o valor `'1mb'` e o `src/main.ts` chamando a função antes do `listen`.
- **A ADR 0005** passou a decidir o limite, com três alternativas rejeitadas. O pattern da fronteira do código gerado inclui o `src/body-limit.ts`, e o README diz o limite.

### Números medidos

- **Antes**, em `a74ca0c`: 300 leads (175,7 KiB) davam 413 em `POST /rest/v1/leads.json` e em `POST /subscriptions/123-ABC-456/persons`; o JSON e o form davam 413 a partir de 101 KiB.
- **Depois**, com `node dist/main` na branch: os 300 leads dão 200 e 202; o JSON e o form de 101 KiB e de 1023 KiB dão 200; os de 1025 KiB dão 413.
- **O e2e novo** falhou em 3 dos 6 casos antes da correção e passa nos 6 depois. Quatro mutações da correção foram pegas pelos testes.
- **`npm run check`**: 3.768 testes em 21 arquivos, com 2 casos novos em `test/runtime-defaults.spec.ts`; o e2e com 39, dos quais 6 novos. Na máquina do dono, com a média de carga entre 19 e 23, 7 testes ficaram vermelhos em `test/hooks/build-guard.spec.ts`, `test/hooks/guard-bash.spec.ts` e `test/scripts/gate.spec.ts`, por `git` estourando o prazo (`spawnSync git ETIMEDOUT`, 5 testes com 120 s), como já tinha acontecido na #20. O lint, o `format:check`, o typecheck, o `check:context`, o build e o `check:all` passaram. A prova da cadeia inteira é o `Qualidade / check` da PR.

### Decisões tomadas

- [0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md): o corpo até 1 MB, o limite que o Marketo documenta, nos dois parsers.
- As respostas do Approve da #25: seguir o Marketo no valor e nos dois parsers, nenhum helper comum para os e2e, e a decisão na ADR 0005.

### Patterns aplicados ou criados

- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md), atualizado com o arquivo novo escrito à mão
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md): HIGH, porque muda um status HTTP que o lite-campaign vê

### Aprendizados / surpresas

- **Um 200 não prova que o corpo foi lido.** O primeiro teste do form mandava 101 KiB para `snippet/:id/content.json`, que lê `content` e `type` como query, como o Swagger declara, e ignora o corpo. Ele passava com `extended: false`. Só um `vi.spyOn` num service que recebe o `@Body()` mostrou que o corpo chega inteiro. Dos 103 POSTs de assets com form, 45 não leem o corpo.
- **O `useBodyParser` só vale antes do `init()`.** No `init()`, o Nest só registra os parsers padrão que ainda não acha montados pelo nome, `jsonParser` e `urlencodedParser` (`node_modules/@nestjs/platform-express/adapters/express-adapter.js:239-241` e `:391-397`). Chamado antes, o parser do limite substitui o padrão, e a pilha do app tem um parser de cada tipo. Chamado depois, ele entraria atrás do padrão de 100 KiB. A primeira versão do Learn dizia que o padrão entrava e passava adiante uma requisição já lida; a revisão do Copilot na PR #60 apontou o erro, e a pilha medida o confirmou.

---

## 2026-09-28: Cada área registra o Swagger que a gerou, com o sha256, e o check:all o confere (#19)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **O registro de cada área.** O gerador de definições emite `src/<área>/<área>-definitions/swagger-source.ts`, com o cabeçalho de gerado, o documento escrito como o cabeçalho o escreve e o sha256 dos bytes dele como estão no commit. O `check:all` o confere como qualquer arquivo gerado, então um Swagger mudado sem regenerar deixa o CI vermelho, mesmo quando nenhum outro arquivo gerado muda.
- **Os bytes fixados.** O `.gitattributes` novo tira os `docs/marketo-swagger-*.json` de toda conversão de fim de linha, e o sha256 fica o mesmo num checkout `core.autocrlf=true`.
- **Só no código.** Pela resposta do dono à pergunta 1, o registro fica em `src/` e no `dist/`, e nenhuma rota, header ou resposta muda.
- **A documentação.** A ADR 0012, a ADR 0004 (a tabela de sha256 virou a origem medida na #6, e a contagem, 1.088 arquivos gerados), a 0008, os patterns [gerar e conferir](../knowledge/patterns/generate-and-check.md) e [a fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md), o README (nas mesmas 118 linhas), o glossário, o `AGENTS.md` e o fluxo. O critério do sha256 do [project intent](../intent/project-intent.md) foi marcado.

### Números medidos

- **Antes**, sobre `e5b013c`: com um `\n` a mais em `docs/marketo-swagger-asset.json`, o `check:all` saía com 0 e 16 linhas "are current". **Depois**: sai com 1, citando `src/asset/asset-definitions/swagger-source.ts`.
- **A saída**: 5 arquivos novos, 35 linhas, e nenhum outro. Sem eles, o `check:definitions` saía com 1 nas cinco áreas. Um segundo `npm run generate:all` não muda nada, e o `format:check` passa.
- **O checkout CRLF**: um clone da branch com `core.autocrlf=true` fica com o status limpo, os cinco documentos em `attr/-text` e os cinco sha256 iguais aos registros.
- **`npm run check`**: 3.765 testes em 21 arquivos, com 16 novos no `codegen.spec.ts`, 15 deles vermelhos antes do Build, e 2 que o `drift.spec.ts` gera para a ADR 0012 e o anti-pattern novo (3.764 na rodada antes do Learn); o e2e com 33, sem mudança. Com a carga média em 20, 4 casos de stack do `gate.spec.ts` estouraram os 120 s na primeira rodada, e o `gate.spec.ts` sozinho passou com os 365.

### Decisões tomadas

- [0012: Cada área registra o Swagger que a gerou, com o sha256 dos bytes commitados](../decisions/0012-swagger-source-record-per-area.md), nova, com as alternativas medidas: o sha256 no cabeçalho de todo arquivo, um manifesto único, normalizar as quebras, `binary`, `text eol=lf` e o registro no `/api-json`.
- [0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md), atualizada.

### Patterns aplicados ou criados

- [Check que só compara a saída derivada](../knowledge/anti-patterns/check-that-only-compares-derived-output.md), anti-pattern novo
- [Gerar e conferir](../knowledge/patterns/generate-and-check.md) e [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md), atualizados

### Aprendizados / surpresas

- **Um check de saída derivada não vê a entrada.** O `check:all` provava o código contra os geradores, mas não o documento contra o registro, e a tabela de sha256 da ADR 0004 podia envelhecer sem ninguém ver. Emitir a identidade da entrada como mais um arquivo de saída fechou o furo sem código novo de conferência.
- **O `read_text()` também esconde as quebras de linha.** Um checkout CRLF mudava o sha256 dos documentos e não mudava o veredito. O hash dos bytes, com os bytes fixados pelo `.gitattributes`, é o que se reproduz com `shasum`.
- **As linhas citadas no plano andam.** Entre o plano (27/09) e o Build, a #5 e a #30 moveram os bullets do `workflow.md` que o plano citava; o passo 0 os achou pelo conteúdo.
- **O harness recusa o que ele não consegue provar dentro do worktree.** Um redirecionamento com `$TMPDIR`, um laço com `$f` e um heredoc que citava `git` foram negados; com os caminhos por extenso, ou pela ferramenta de edição, passaram. Um log escrito com `$PWD/../../..` caiu no checkout principal, e foi apagado sem tocar em mais nada lá.

---

## 2026-09-28: O npm ci não manda mais o evento de instalação do Scarf (#20)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **O `package.json` desliga o Scarf.** `"scarfSettings": {"enabled": false}`, no fim do arquivo, faz o `postinstall` do `@scarf/scarf`, que chega por `@nestjs/swagger` → `swagger-ui-dist`, desistir do `POST /package-event/install` para `scarf.sh`. Vale no CI, no dono e nos agentes, sem variável de ambiente.
- **Um caso novo em `test/runtime-defaults.spec.ts`** exige o valor `false`, e falha sem a chave ou com a string `"false"`.
- **A ADR 0010 passou a decidir a instalação,** com três alternativas rejeitadas: a variável no `check.yml`, o `--ignore-scripts` e a guarda dos scripts de instalação no lockfile. O project intent cita a #20 no critério da rede.

### Números medidos

- Numa cópia do `package.json` e do `package-lock.json` num caminho sem espaço, com `SCARF_LOCAL_PORT` apontado para um listener local: o `npm ci` com o `package.json` de `e5b013c` mandou 1 `POST /package-event/install` (623 bytes); com o da branch, 0.
- `npm install --package-lock-only` não mudou o lockfile.
- **`npm run check`**: 3.748 testes em 21 arquivos, com 1 caso novo em `test/runtime-defaults.spec.ts`; o e2e com 33. Na máquina do dono, com a média de carga entre 18 e 25, três rodadas deixaram de 9 a 17 testes vermelhos, sempre em `test/hooks/` e em `test/scripts/` (`gate.spec.ts`, `audit-main.spec.ts`), em arquivos e casos diferentes a cada rodada, por `git` estourando o prazo dentro dos hooks. O `runtime-defaults` passou nas três, e o lint, o `format:check`, o typecheck, o `check:context`, o build e o `check:all` também. A prova da cadeia inteira é o `Qualidade / check` da PR.

### Decisões tomadas

- [0010: O mock só fala com a própria máquina por padrão](../decisions/0010-loopback-only-by-default.md): a instalação entrou na decisão, com uma linha `Atualizado`.
- As respostas do Approve da #20: registrar na ADR 0010, sem ADR nova; nenhuma variável no `check.yml`; e sem a guarda dos scripts de instalação no lockfile, que o dono achou controle demais.

### Patterns aplicados ou criados

- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md): NORMAL, porque a PR só toca o `package.json`, um teste fora de `test/scripts/` e `context/`

### Aprendizados / surpresas

- **Num caminho com espaço, o Scarf desiste em silêncio.** O `report.js` roda `cd <caminho> && npm ls` sem aspas, e num caminho como o do checkout do dono, que tem um espaço, o `cd` quebra. O checkout do dono não mandava o evento; o CI mandava. Uma medição de rede no checkout do dono engana, e por isso a medição foi feita numa cópia fora dele.
- **Uma chave nova no topo do `package.json` desloca as citações `package.json:N`.** No topo, o `scarfSettings` teria deslocado umas 20 citações das ADRs, do glossário e de um pattern. No fim do arquivo, nenhuma mudou.

---

## 2026-09-28: O issue-link só relata a revisão do Copilot e as threads, e o veredito fresco é só o gate (#30)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **O gate ganhou `--review-report`.** No modo CI, fora de draft, a opção faz `copilot-review` e `review-threads` só relatarem. Cada um que bloquearia vira uma annotation `::warning::` na PR e uma linha no resumo do job, e o gate sai com 0 se o resto está em ordem. Sem a opção, que é o veredito fresco, os dois bloqueiam como antes.
- **O `issue-link.yml` passa a opção.** Como o `pull_request_target` lê o YAML de `main`, uma PR não consegue tirá-la, e um teste fixa que o veredito fresco das docs nunca a passa.
- **Saíram o `Sinal de revisão` e o modo `workflow_run` do refresh.** O refresh ficou com os eventos de issue e o disparo a pedido, e os contratos, o script, os testes e o `gh` falso perderam o que só o sinal usava.
- **O veredito fresco é só o gate em modo CI na cabeça da PR.** Um rerun do `issue-link` não é mais veredito fresco, porque roda com a opção. A nota de refresh interrompido e as docs passaram a dizer isso.
- **O hook de `gh pr merge` (#5) e a auditoria de `main` seguem exigindo** a revisão na cabeça, nenhum pedido pendente e nenhuma thread aberta, com testes novos que montam os checks exigidos verdes.
- **As docs dizem a regra nova:** a ADR 0003, a ADR 0002, o fluxo, o `AGENTS.md`, o glossário, os patterns do gate, da revisão e do ciclo de vida e o intent da #13. Nenhuma diz mais que o refresh não foi provado ao vivo, que toda revisão dispara o sinal ou que um rerun do `issue-link` é veredito fresco, e os JSDoc dos scripts também não.

### Números medidos

- **Antes**, pelo plano da #30: 32 de 76 tentativas do `issue-link` vermelhas, todas em `copilot-review`, e 4 das 5 PRs mergeadas sob a regra da #13 só ficaram verdes com um `gh run rerun` manual.
- **`npm run check`**: 3.747 testes em 21 arquivos, com 8 casos novos no `gate.spec.ts`, 3 das revisões do Copilot no `drift.spec.ts` e os testes do modo `workflow_run` e da busca por branch removidos do `refresh-issue-link.spec.ts`; o e2e com 33.
- **Mutações**: as 7 da opção foram pegas pelos testes.
- **O rerun pelo `GITHUB_TOKEN`** passa, medido ao vivo nas runs 36263677912 (tentativa 2) e 36269762597 (tentativas 3 e 4), e as docs deixaram de dizer o contrário.

### Decisões tomadas

- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md): o `issue-link` relata, e o veredito fresco, o hook de merge e a auditoria exigem. As opções (b), esperar o pedido pendente, e (c), uma varredura agendada, ficaram como alternativas rejeitadas.
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): a camada 1 e os Limites sem o sinal de revisão, e com o rerun medido.
- As quatro respostas do Approve da #30: a correção (a), o sinal fora, o aviso só na annotation e no resumo do job, e a branch cortada depois da #5.

### Patterns aplicados ou criados

- [Check que espera um evento que não chega](../knowledge/anti-patterns/check-waiting-for-an-event-that-never-comes.md), anti-pattern novo
- [O gate do loop](../knowledge/patterns/loop-gate.md), [Revisão antes do merge](../knowledge/patterns/review-before-merge.md) e [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md), atualizados

### Aprendizados / surpresas

- **Um check exigido não pode depender de um evento que não chega.** O sinal foi desenhado sem medir a revisão do próprio Copilot, e a medição da PR #15 mostrou o `action_required`. Relatar no check e exigir no ponto da decisão resolve sem gastar minuto de runner.
- **O Build do harness passou pelos hooks da #5.** Com os hooks ligados desde a PR #55, cada edição no gate, nos workflows e nos scripts do loop pediu a confirmação do dono, porque a sessão saiu do modo automático. Em `auto`, essas edições seriam negadas.
- **Um redirecionamento para `$TMPDIR/...` foi negado pelo `guard-bash`,** porque o hook não lê a expansão, e a linha inteira não rodou. Com o caminho escrito por extenso, passou.
- **As mutações rodaram numa cópia da árvore fora do git.** Mutar o `scripts/gate.mjs` pelo shell teria escrito no harness sem passar pela confirmação do dono, que é o limite da tripwire registrado na ADR 0002.
- **Os testes dos hooks falham por tempo quando a máquina está carregada.** Com a média de carga entre 15 e 20, duas rodadas do `npm run check` falharam em testes diferentes do `guard-bash` e do `session-context`, e a terceira passou inteira.
- **A prova ao vivo depende do merge.** O `issue-link` desta PR ainda roda o gate de `main`, o de antes. A primeira PR depois do merge mostra se ele fica verde sem rerun.
- **Um teste de drift pela frase exata deixa passar a mesma regra dita de outro jeito.** As revisões do Copilot na PR #56 acharam o sinal ainda no presente e um rerun do `issue-link` ainda dado como veredito fresco, num parêntese de JSDoc, no "Quando usar" do gate e no intent da #13, que nenhuma lista do drift incluía. O `drift.spec` passou a conferir toda frase que junta os dois termos, nas docs, nesse intent e nos JSDoc dos scripts.

---

## 2026-09-28: Os hooks do Claude Code param o agente antes da ação, numa stack de 10 PRs (#5)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **Quatro hooks de projeto em `.claude/hooks/`,** ligados pelo `.claude/settings.json`:
  - o `guard-bash` julga, antes de cada comando, os `gh` e `git` que contornam o loop. Ele nega o Approve escrito pelo agente, `ready-for-agent`, toda escrita de label de estado menos a troca de `needs-triage` por `ready-for-human` depois de um `# Plano`, a PR sem `Closes #N.`, commit e push em `main`, os tokens de skip e resolver uma thread sem ter respondido nela. Pede confirmação antes de um merge, e o nega quando a revisão do Copilot, os pedidos pendentes, as threads ou os checks exigidos, lidos ao vivo, não estão em ordem;
  - o `build-guard` só deixa editar fora de `context/intent/` com o cache do gate aberto para a branch, e nega em `main`;
  - o `plan-to-issue` marca como pendente o plano aceito no plan mode até ele ser publicado numa issue;
  - o `session-context` diz a branch, a issue e o estado do gate, e lembra que aprovação no chat não é Approve.
- **Os hooks só restringem:** nenhum devolve `allow`, e em `bypassPermissions`, `dontAsk` e `auto` a confirmação crítica vira negação. O `run.sh` sai com 2 quando o script ou o `node` falta.
- **O `gateStatus()`** fecha o cache enquanto existir o marcador de um plano pendente, por mais recente que seja o gate (`planPendingFile` e `pendingPlan`).
- **A stack.** O código veio da `9377db6`, a cabeça da PR #26, que passou por dez revisões do Copilot e foi fechada pelo dono. Ele entrou sem reescrita em dez fatias, na ordem do grafo de imports, cada uma com sub-issue, PR, revisão e merge próprios: #42, #43, #44, #45, #47, #51, #52, #53, #54 e a da fatia 10. Nenhuma fatia registrou hook antes da última.
- **As revisões das fatias 1 a 9** acharam 56 pontos em 17 revisões completas. Sete viraram correção:
  - os testes do orçamento de tempo e o roteiro do intent (#42);
  - o `git clean -x` que apagava a saída de emergência do dono e a pasta com arquivos do harness nomeada como pathspec (#45);
  - as opções com valor do `gh repo edit` (#47);
  - a seção vazia contada como plano publicado e o caminho de reserva num repositório de outro projeto (#54).

  Cada correção de código tem teste e mutações que os testes pegam. Os outros achados viraram limite pelo critério do agente cooperativo, ou não procediam.
- **As docs falam dos hooks no presente:** a camada 3, os limites e o critério do agente cooperativo na ADR 0002, a seção Os hooks do Claude Code e o que a stack mediu no fluxo, o README dos hooks, a rota no `AGENTS.md` e um teste de drift que confere o presente e que o fluxo nomeia cada hook que existe.
- **Os critérios da #17** que ficaram para depois do merge foram marcados, com a evidência de cada um.

### Números medidos

- `npm run check`: 3.742 testes em 21 arquivos, dos quais 2.249 são dos hooks, em 12 arquivos de `test/hooks/`.
- O código dos hooks tem 14,7 mil linhas; os testes, 18,6 mil, e o suporte deles, 1,0 mil.
- O tamanho de cada PR, com `gh pr diff`: de 48.644 bytes (#53) a 222.324 (#45). A #47 falhou três vezes com 241.186 bytes e foi revisada com 179.248.
- Os achados do Copilot por PR: 5 na #42, 8 na #43, 3 na #44, 27 na #45, 7 na #47, nenhum na #51, 2 na #52, nenhum na #53 e 4 na #54. Nenhuma fatia passou de três revisões completas.
- Contra a `9377db6`, os arquivos de `.claude/hooks/` e `test/hooks/` só diferem pelas correções das revisões e pelos testes delas.
- As duas sondas do plano foram negadas com os hooks ligados: a troca de label pelo `guard-bash` e o `Edit` numa sonda `claude/x` pelo `build-guard`.

### Decisões tomadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): a camada 3 existe, com os limites dela e os do critério do agente cooperativo.
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md): os hooks fazem valer responder antes de resolver e conferem a revisão ao vivo antes do merge.
- O plano de 10 fatias (Approve de 2026-09-28 11:42 UTC) e o critério do agente cooperativo (Approve de 09:15 UTC).

### Patterns aplicados ou criados

- [Corpus de comandos reais](../knowledge/patterns/real-command-corpus.md), novo, da PR #26
- [Guarda que só reconhece o nome literal](../knowledge/anti-patterns/guard-by-literal-name.md), anti-pattern novo, da PR #26
- [Uma PR que prende partes independentes](../knowledge/anti-patterns/one-pr-for-many-independent-parts.md), aplicado, com o limite de tamanho da revisão do Copilot
- [O gate do loop](../knowledge/patterns/loop-gate.md) e [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md), atualizados

### Aprendizados / surpresas

- **O Copilot tem um limite de tamanho que não está documentado.** A PR #47, com 241.186 bytes de diff, recebeu três revisões "Copilot wasn't able to review any files", e a #45, com 222.324, foi revisada. Cortar a fatia resolveu na primeira tentativa, e as PRs de depois ficaram abaixo de 180 KiB, a margem adotada ali.
- **O GitHub não liga uma PR de fatia à sub-issue quando muda a base dela para `main`.** Em todos os merges da stack, a PR de cima ficou sem vínculo até uma edição no corpo, que o cria na hora.
- **Um merge com um rerun do `issue-link` em andamento deixou a auditoria de `main` ler um run vermelho** (#46, relato #48). O refresh re-roda o `issue-link` depois de cada resposta numa thread, e desde a fatia 3 o merge espera nenhum run em andamento.
- **O critério do agente cooperativo encurtou as rodadas.** Na PR #26, cada achado virou correção, e foram dez rodadas. Na stack, 7 dos 56 achados viraram correção, e nenhuma fatia passou de três revisões completas.
- **Um teste que lê um arquivo de uma fatia de cima vai com o arquivo.** Os testes do prazo do `guard-bash` e do `session-context` leem o `.claude/settings.json` e falharam na fatia deles até irem para a última.
- **Cortar um spec entre blocos deixa imports sem uso na metade de baixo,** que o `lint` aponta: eles saem e voltam com a metade que os usa.
- **Depois do merge de uma fatia de baixo, o gate em modo CI local precisa de um `git fetch`.** Com o `origin/main` velho, ele recusou o `pr-base` de uma fatia já liberada.
- **Os avisos do monitor de CI chegaram depois dos merges,** com threads já respondidas. Cada um foi conferido contra o estado da PR antes de qualquer ação.
- **Os hooks seguem o `.claude/settings.json` do checkout da sessão.** A primeira tentativa da sonda do `build-guard` trocou o worktree da sessão para uma branch cortada de `main`, que ainda não tinha o arquivo, e os hooks saíram com ele: o `Edit` passou. A sonda foi refeita num worktree próprio, e o limite foi para a ADR 0002.

---

## 2026-09-27: Uma mudança grande pode vir numa stack de PRs, com uma sub-issue por fatia (#31, PR #33)

**Fase**: Learn
**Tipo**: Process

### O que foi construído / corrigido

- **A stack no contrato.** O plano vigente da issue mãe declara a stack numa seção `## Stack`: a lista numerada das branches das fatias, de baixo para cima (`stackOf`, `slicePosition`). Cada fatia é uma sub-issue da mãe, com a label de categoria e `stack-slice` e sem label de estado.
- **O gate julga uma fatia pela mãe.** O estado, as seções, os critérios e o Approve vêm do plano vigente da mãe, e toda revogação do Approve da mãe vale para todas as fatias. A branch precisa estar na `Stack`, e toda branch da `Stack` precisa ser de uma fatia da mãe: uma sub-issue dela, deste repositório, com `stack-slice`. A mãe precisa ser deste repositório, estar aberta, ter exatamente uma label de categoria e não ser ela mesma uma fatia, e uma mãe que não se lê deixa o veredito não verificado.
- **Os passos numa fatia.**
  - `pr-base` aceita a fatia logo abaixo só em draft, e `main` na primeira fatia ou, nas outras, depois de as de baixo mergearem.
  - `stacked` não conta como estranhas as fatias de baixo nem o merge delas, e isenta uma fatia de cima só quando ela foi cortada desta.
  - `intent-first` bloqueia só na primeira fatia, e `learn` só na última, citando a mãe. `commits-cite-issue` bloqueia acima da primeira fatia, no CI fora de draft.
- **O `pr-size`**, um passo novo que só relata as linhas alteradas da PR contra a base, com 1.500 de referência.
- **O refresh** re-roda também as PRs abertas das sub-issues deste repositório com `stack-slice` quando há um evento na mãe.
- **A label `stack-slice`** foi criada. A ADR 0001, o ciclo de vida de issue e branch, o gate do loop, o fluxo, o glossário e o `AGENTS.md` descrevem como montar, revisar, atualizar e mergear uma stack, e "fatia" ficou reservada para a fatia de uma stack.
- **A verificação adversarial**, antes da PR, achou dez pontos. Nove foram corrigidos com caso de teste:
  - a ordem do merge de baixo para cima;
  - os commits das fatias acima da primeira;
  - a isenção condicional da fatia de cima;
  - o formato estrito da `Stack`;
  - a mãe que não se lê;
  - duas branches de uma issue;
  - a mãe de outro repositório;
  - as sub-issues de outro repositório no refresh;
  - os casos de teste que faltavam.

  O décimo é de antes da #31 e virou a #32.
- **As quatro revisões do Copilot** na PR #33 acharam nove pontos, cinco em threads e quatro só no resumo. Oito foram corrigidos com caso de teste:
  - uma fatia de cima cortada de uma fatia de baixo, que uma lista vazia de commits fazia passar por cortada desta;
  - uma ref que o git não consegue comparar com o HEAD, que uma fatia de cima isentava e o teste geral do `stacked` deixava passar;
  - uma branch da `Stack` que não é de uma fatia da mãe, que passava por fatia de baixo ou de cima;
  - a mãe que também é fatia;
  - a mãe sem categoria ou com duas, cujo plano era julgado como de feature;
  - as falhas de leitura da mãe que o cache guardava como verificadas;
  - o code span de mais de uma crase na `Stack`;
  - o refresh das sub-issues que não são fatias.

  O nono era a contagem de rodadas da #26 no intent, que dizia nove.
- **A segunda rodada adversarial**, antes do merge, teve duas lentes.
  - **O que passa sem dever** achou três brechas, cada uma corrigida com caso de teste:
    - uma fatia de baixo sem ref, ou com a ref ainda em `main`, contava como mergeada, e agora conta só com a sub-issue fechada;
    - a reabertura de uma fatia, e uma retirada ou uma revisão postada nela, não revogavam o Approve da mãe para ela;
    - um `git rev-list --first-parent` que falhava virava "nenhum commit próprio".

    O quarto ponto dessa lente ficou registrado como limite: o refresh não re-roda as fatias irmãs depois de um evento numa fatia.
  - **O fluxo documentado de ponta a ponta** achou seis bloqueios, todos corrigidos:
    - toda PR de cima em draft falhava no `pr-closes`, porque o GitHub só liga as palavras de fechamento numa PR para `main`, e agora o gate lê o corpo;
    - um commit sem número numa fatia de baixo, trazido pela de cima, travava a de baixo sem conserto possível;
    - uma fatia de cima cortada antes do primeiro commit da de baixo travava a de baixo;
    - a `## Stack` era ignorada num plano do form;
    - o conserto de recorte de uma fatia mandava cortar de `main`, e o `pr-size` sugeria uma stack a uma fatia.

### Números medidos

- **Os testes**, contados com `npx vitest list --json`: 1.402 em `main` (`63f69ec`) e 1.487 depois da segunda rodada adversarial.
  - O `gate.spec.ts` foi de 293 para 357: 56 casos no bloco da stack, 7 mutações novas do gh falso e um caso novo do `stacked` fora da stack.
  - O `loop-sections.spec.ts` foi de 447 para 460, o `refresh-issue-link.spec.ts` de 65 para 72 e o `drift.spec.ts` de 184 para 185.
- **Os checks**: `npm run check` com saída 0, 1.487 testes em 9 arquivos, o `check:context` sem problemas e as linhas "are current" do `check:all`; o e2e com 33.
- **As mutações**: cada uma das 19 mutações das correções das revisões do Copilot, e das 13 da segunda rodada adversarial, derruba pelo menos um caso. Uma checagem estrutural da isenção da fatia de cima saiu porque a mutação dela sobreviveu: o `foreignMerges` e a citação da sub-issue de cima já pegavam o que ela pegaria.
- **O tamanho desta PR**, contado com `git diff --numstat origin/main...HEAD`:
  - antes do Learn, 2.887 linhas alteradas contra `main`, o que o `pr-size` relatou na própria PR;
  - em `2646749`, depois da quarta revisão do Copilot, 3.679 (+3.503 −176) com `--diff-algorithm=minimal`, 2.339 delas em testes e 1.017 em `scripts/`. Nessa cabeça, o algoritmo padrão do git alinha mal o `gate.spec.ts` e dá 4.055 (+3.691 −364), com as mesmas mudanças;
  - em `ea4d92a`, depois da segunda rodada adversarial, 4.356 (+4.166 −190) com `--diff-algorithm=minimal`, 2.823 delas em testes e 1.196 em `scripts/`, e 4.714 com o algoritmo padrão.

  As duas contagens passam da referência de 1.500.
- **A PR #26**, que motivou a issue: +34.550 −61 em 50 arquivos, e dez revisões do Copilot, com 6, 6, 11, 4, 5, 3, 2, 1, 1 e 2 comentários.

### Decisões tomadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md): PRs podem ser empilhadas numa stack declarada no plano da mãe, com uma sub-issue por fatia.
- As cinco recomendações do plano da #31 ficaram:
  - a seção `Stack` e a label `stack-slice`;
  - a PR de cima em draft até a de baixo mergear;
  - o `intent-first` na primeira fatia e o `learn` na última;
  - o `pr-size` só relatado, com 1.500 linhas;
  - a ordem: a #31, a stack da #5 e a #30.

### Patterns aplicados ou criados

- [Uma PR que prende partes independentes](../knowledge/anti-patterns/one-pr-for-many-independent-parts.md), novo.
- [O gate do loop](../knowledge/patterns/loop-gate.md) e [o ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md), com as seções da stack.

### Aprendizados / surpresas

- **Prosa que cita uma branch não pode virar regra.** A primeira versão da `Stack` aceitava qualquer item de lista com uma branch, então uma nota do plano que citasse uma branch a punha na stack e a isentava do `stacked`. O formato estrito separa a lista da prosa.
- **Uma isenção precisa de uma condição que a feche.** Isentar de uma vez as fatias de cima abria o `stacked` para uma fatia de baixo que trouxesse os commits da de cima.
- **A ordem do merge precisa ser conferida, e não só escrita.** Sem o `pr-base` olhar as fatias de baixo, uma fatia de cima apontada para `main` levaria as de baixo junto, sem o gate delas.
- **Uma isenção não pode nascer de uma falha, nem de uma lista vazia.** O `cutFromHere` tomava um `git merge-base` que falhou por prova de que a fatia de cima foi cortada desta, e o teste geral do `stacked`, de antes da #31, tomava a mesma falha por "nada em comum". Só a saída 1 do git diz que não há commit em comum, e qualquer outra falha agora bloqueia. Depois, o `every` de uma lista vazia também passava por prova de corte; a isenção agora pede pelo menos um commit desta fatia, como o `headCitesIssue` já pedia.
- **Percorrer o fluxo documentado acha o que a caça a brechas não acha.** As revisões do Copilot e a primeira rodada adversarial procuravam o que passa sem dever, e cada correção apertava uma regra. A rodada que percorreu o fluxo de ponta a ponta achou seis bloqueios de fluxo legítimo. Dois eram graves: a PR em draft sem vínculo e o deadlock de um commit sem número. Uma regra que bloqueia pede os dois olhares antes do merge.
- **Quem empresta as regras de outra issue precisa conferir que ela é o que diz ser.** O gate lia da mãe o estado, o plano e o Approve, mas não conferia que ela fosse uma raiz (uma categoria só e nenhum `stack-slice`), nem que as branches da `Stack` fossem de fatias dela. As revisões do Copilot acharam as três faltas.

---

## 2026-09-26: Os geradores falham sem Prettier, se declaram gerados e rodam no CI (#7)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **Os geradores falham alto.** Sem o Prettier ou sem node, eles param antes de tocar a saída e saem com 2, com uma mensagem que diz o que falta. Antes, o binário ausente era pulado em silêncio, e o node ausente virava traceback depois do `rmtree`.
- **Nenhum arquivo de ignore alcança a saída gerada.** O Prettier roda com `--ignore-path=`, e o gerador confere que cada caminho passado aparece no relatório por arquivo. A regra da #6, "o Prettier dos geradores lê só o `.prettierignore`", foi substituída pela [ADR 0011](../decisions/0011-generators-format-without-ignore-files.md).
- **Todo arquivo gerado se declara gerado.** Os 1.083 abrem com duas linhas `//` que dizem o gerador e o comando de regenerar; os 1.080 das áreas dizem também o documento de origem, e os 3 de `src/mocks`, só o gerador, e o `--check` confere o cabeçalho como o resto do arquivo.
- **O `check:all` roda no CI.** Ele fecha a cadeia do `npm run check`, e o `forms-parity.spec.ts` pina a cadeia e os scripts `check:*`.
- **A revisão adversarial.** O cabeçalho de uma área avulsa passou a dar as flags que a regeneram; o node entra no `PATH` do Prettier em caminho absoluto; o `PRETTIER_EXPERIMENTAL_CLI` sai do ambiente dele; o range do arquivo inteiro protege a conferência junto com o `--no-require-pragma`; e dois limites do `--check`, a config do Prettier que depende do caminho e a saída sem formatação depois de uma falha no modo de gerar, foram para a #29. As revisões do Copilot somaram um Prettier sem permissão de execução e um `NODE_BIN` cujo `node` não executa, que também saem com 2, e as aspas no caminho do documento no comando do cabeçalho de uma área avulsa.
- **O merge de `main` depois da #8.** Os 10 conflitos, todos de documentação, foram resolvidos por regra, a saída foi regenerada com o gerador mesclado, e as citações foram remapeadas pelo lado de origem de cada linha. Uma segunda rodada adversarial verificou as correções e o merge, e o spec passou a cobrir o documento atrás de um link, o node relativo, as variáveis `PRETTIER_*` e a mensagem de restauração.
- **Um teste novo**, `test/scripts/codegen.spec.ts`, roda os três geradores numa árvore temporária, com o alvo `identity`: sem Prettier, com `NODE_BIN` sem node, sob `.prettierignore`, com um Prettier que pula arquivos e com o cabeçalho.

### Números medidos

- **O spec**: 20 dos 31 casos falhavam em `3ddceb4`, e os 31 passam depois. As revisões o levaram a 55 casos, que passam em cerca de 7 s, e cada correção foi conferida por mutação. Os casos de factories no `identity` passam antes e depois, porque essa saída já nasce formatada, e ficam como controle.
- **A saída**: 1.083 arquivos com 3 linhas a mais cada, e nenhuma outra mudança (`git diff -U0 | grep '^@@'` dá só `@@ -0,0 +1,3 @@`). Um segundo `generate:all` não muda nada, e o `format:check` passa.
- **Os checks**, na cabeça `217042d`, depois do merge da #8: `npm run check` com 1.395 testes em 9 arquivos e as 16 linhas "are current"; o e2e com 33, os 19 da #8 inclusive; e a run 36279581085 do `Qualidade / check`, success. Antes da #7, a run 36270989088 levou 93 s de vitest e 114 s no passo `npm run check`.
- **Sem node**, numa máquina sem `/usr/local/bin/node` nem `/opt/homebrew/bin/node`: saída 2 e a mensagem, sem traceback e sem mudar a saída.
- **O Prettier 3.9.6**: um arquivo ignorado e passado pelo nome sai com 0 no `--write` e no `-l` sem mensagem, e no `--check` com "All matched files use Prettier code style!".

### Decisões tomadas

- [0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](../decisions/0011-generators-format-without-ignore-files.md), nova, da pergunta 1 do plano revisado depois do merge da #6.
- A ADR 0004 ganhou o cabeçalho de gerado, e a 0008, o Python 3.9 como mínimo e o python3 da imagem do runner no CI, sem `setup-python`. A 0002 ganhou o `check:all` na cadeia, e as 0005, 0006, 0007 e 0009, as citações deslocadas.

### Patterns aplicados ou criados

- [Confiar que a ferramenta processou o arquivo passado pelo nome](../knowledge/anti-patterns/trusting-a-tool-to-process-a-named-file.md), novo.
- [Gerar e conferir](../knowledge/patterns/generate-and-check.md): o commit dos geradores e o da saída separados, e a saída provada pela contagem de hunks.
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md): um arquivo gerado se reconhece pelo cabeçalho.

### Aprendizados / surpresas

- **O plano previa uma #6 diferente da que entrou.** A #6 manteve o `.codegen-tmp` e registrou uma decisão sobre o `.prettierignore` depois do Approve da #7. O passo 0 do plano pegou a divergência, e um `# Plano` revisado a levou ao dono antes do corte da branch.
- **Uma citação só se confere pelo conteúdo.** O cabeçalho de 3 linhas e as mudanças nos geradores deslocaram centenas de citações `arquivo:linha`, que o `check:context` não confere. Um script as remapeou por diff, mas a revisão adversarial achou três grupos que ele não pegou: uma citação presa a um commit pela prosa ("naquele commit"), continuações `:N` sem o nome do arquivo e uma tabela com as linhas entre parênteses. Eles foram conferidos pelo conteúdo da linha e corrigidos.
- **O runner tem outro node.** A imagem do `ubuntu-latest` traz o Node 22 em `/usr/local/bin`, que o gerador punha na frente do Node do `.nvmrc` (inferido dos scripts da imagem, não medido num runner). O `PATH` passou a vir antes dos candidatos fixos, e o caso "sem node" do spec usa um `NODE_BIN` sem node, que se reproduz em qualquer máquina.

---

## 2026-09-26: Cada requisição chega ao próprio handler, e o gerador ordena as rotas (#8)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

- **13 rotas sombreadas passaram a chegar ao próprio handler.** Eram 11 de assets e 2 de Lead Database: `smartCampaign/byName.json`, `rules.json`, `flowSteps.json` e `flowStepTypes.json`, `smartList/byName.json` e `rules.json`, `staticList/byName.json`, `email/ccFields.json`, os três `v2/<tipo>/bulk/delete` e `GET` e `POST customobjects/schema.json`. Cada uma caía numa rota com parâmetro do mesmo método, declarada antes dela no mesmo controller.
- **A regra de ordem, no gerador.** Dentro de cada tag, a ordem do Swagger se mantém, mas uma rota sobe para logo antes da primeira rota que a capturaria. A comparação ignora maiúsculas e minúsculas, como o Express, e troca os parâmetros por `{}`, que nenhum literal contém. Se duas rotas se capturam uma à outra, a geração falha com o par. A saída veio de `npm run generate:resources`, sem ajuste à mão.
- **Dois testes em `test/route-order.e2e-spec.ts`.** Um lê o roteador do app montado e exige que a primeira camada que casa com uma requisição de exemplo de cada rota seja a própria. O outro, por HTTP, põe um `vi.spyOn` no método de service de cada rota e no da rota que a capturava. As linhas são tipadas: um nome de handler errado não compila. O caso entre controllers de `form-fields` entrou nos dois, sem mudar a ordem dos módulos. Os helpers de documento e de roteador foram para `test/support/marketo-routes.ts`, que o e2e da #6 também usa.
- **O contexto.** A ADR 0005 ganhou a exceção na ordem das rotas e as alternativas medidas, e a ADR 0009, o anti-pattern, o pattern `resource-module-shape`, o glossário e o project intent acompanharam.

### Números medidos

- **Antes da correção**, em `3ddceb4`: 14 dos 19 testes novos falham (o do roteador, com as 13 rotas, e 13 linhas por HTTP), e passam a guarda, as 2 linhas de `form-fields` e os 2 controles.
- **A saída regenerada**: 16 arquivos e 181 linhas movidas, nenhuma alterada (conteúdo ordenado idêntico, conferido com `sort | shasum`). A alternativa descartada no plano, uma ordenação estável pelo número de parâmetros, movia 1.308 linhas em 52 arquivos.
- **Depois**: os 19 testes passam; `npm run check` com 1.345 testes; o e2e com 33 (19 desta issue, 12 da #6 e 2 do smoke da #9); `check:all` sai com 0; um segundo `generate:all` não muda nenhum arquivo.
- **As citações**: as 47 linhas do gerador citadas sem commit em `context/` foram conferidas contra `3ddceb4` depois do deslocamento, e apontam para o mesmo código.
- **A verificação adversarial**: 12.511 pares de requisição e método sondados, e só as 13 rotas mudam de handler, com os mesmos status. Com o `FormsModule` antes do `FormFieldsModule`, o teste do roteador e as 2 linhas de `form-fields` falham. No `/api-json`, 48 das 335 chaves de `paths` mudam de posição, com o mesmo conteúdo.

### Decisões tomadas

- [0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md): a ordem das rotas é a do Swagger, com a exceção da rota que seria capturada.
- As seis perguntas do plano ficaram com as recomendações: a branch nasceu depois do merge da #6, as 2 rotas de Lead Database entraram, o caso entre controllers ficou só com o teste, o "teste estático" do relato virou o teste do roteador montado, a regra é o movimento mínimo, e a ADR 0005 foi emendada em vez de uma ADR nova.

### Patterns aplicados ou criados

- [Gerar e conferir](../knowledge/patterns/generate-and-check.md): o commit do gerador e o da saída separados, com o `check:all` na verificação.
- [A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md), com a regra de ordem.
- [Rota literal declarada depois de uma rota com parâmetro](../knowledge/anti-patterns/literal-route-after-param-route.md), que passou a descrever o defeito no passado e o caminho certo no presente.

### Aprendizados / surpresas

- **Observar o handler, não a resposta.** Em `smartCampaign/byName.json`, a rota errada devolve o mesmo tipo que a certa. Só um spy no service, ou o matcher do próprio roteador, mostra para onde a requisição foi.
- **Um rascunho validado encurta o Build.** Os testes e o gerador foram rascunhados e medidos na head da PR #21 antes do merge dela. Depois do merge, o gerador de resources estava igual, e o Build foi aplicar, regenerar e remedir.
- **Uma inserção no topo de um arquivo muito citado desloca dezenas de citações.** As citações sem commit do gerador passaram por um mapa de deslocamento, conferido linha a linha contra o commit de antes. As correções que vieram depois foram escritas sem mudar o número de linhas, para não deslocar nada de novo.
- **Imitar o casador de verdade, não o documento.** A verificação adversarial achou duas diferenças entre o `captures()` e o Express que nenhum documento exercita hoje: a caixa e uma amostra que coincide com um literal. O teste do roteador pegaria as duas no dia em que aparecessem, mas o gerador passaria a emitir a ordem errada antes disso.

---

## 2026-09-26: Reescrita multi-API, cinco documentos Swagger em main (#6, PR #21)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **Cinco alvos, uma área cada.** O registro `TARGETS` de `scripts/marketo_codegen.py` liga cada documento de `docs/` a uma área de `src/`: assets, Data Ingestion (em OpenAPI 3), Identity, Lead Database e User Management. O mock passou de 220 para 388 operações, e a Track A ganhou as rotas de que o R3 e o R4 dependem, `/identity/oauth/token` e `/userservice/management/...`.
- **Os geradores do dono.** Eles aceitam `--target`, ou `--swagger` com `--area`, leem Swagger 2.0 e OpenAPI 3, calculam os imports com `relative_import()`, mandam `ResponseOf*` para `responses/` e põem o seed e o `requestId` num `src/mocks/` comum. A saída veio de `npm run generate:all`, sem nenhum ajuste à mão.
- **O `check:all` passou.** Além dos caminhos, faltava uma causa: o Prettier 3 lê o `.gitignore`, que lista `/.codegen-tmp/`, e não formatava a cópia que o `--check` compara. O Prettier dos geradores passou a ler só o `.prettierignore`.
- **O status documentado.** O controller ganha `@HttpCode` quando o menor 2xx declarado difere do padrão do Nest: os 139 POSTs de assets passaram de 201 para 200, e os 7 de Data Ingestion respondem 202 sem corpo.
- **Um e2e novo** confere as 388 rotas contra os documentos, recusa método+caminho repetido e faz um pedido por área.
- **O `--area` ficou restrito.** As revisões do Copilot apontaram que ele aceitava uma área registrada, um `..`, um caminho absoluto ou uma pasta com arquivos escritos à mão, e o gerador apagaria a pasta. Agora ele só aceita uma pasta em kebab-case, direto em `src/`, que não guarde nada além das três pastas de gerador, e dentro delas o gerador recusa apagar um arquivo que não vá escrever de novo.
- **O contexto.** A ADR 0004 passou a uma fonte por área, com a origem e o sha256 dos cinco documentos. As ADRs de 0005 a 0009 ganharam emendas, e os patterns, os anti-patterns, o glossário, o `AGENTS.md`, o fluxo e o project intent acompanharam.

### Números medidos

- **Os documentos**, contados com python: 459 schemas, 335 caminhos, 388 operações e 49 tags, sem método+caminho repetido entre eles. Os quatro novos são os blobs de AdobeDocs/marketo-apis em `89c8e262` (`git hash-object`). O de assets tem o mesmo JSON que o blob de lá, que tem 8 bytes a mais de espaço no fim de duas linhas.
- **A saída.** 1.083 arquivos gerados. Os 604 que a reescrita trouxe batem por sha256 com os que o dono gerou, e um segundo `npm run generate:all` não muda nenhum arquivo.
- **O `check:all`.** Sem a correção do Prettier, 14 dos 16 checks falhavam e acusavam 829 arquivos. Com ela, os 16 saem com 0, também num clone limpo.
- **As rotas.** As 220 de assets ficam na mesma ordem. Pelo roteador do Express, 13 das 388 são sombreadas: as 11 de assets e 2 de Lead Database. Por HTTP, as 2 de Lead Database caem no handler de `rest/v1/customobjects/:customObjectName.json`, e a medição foi para a #8.
- **Os checks**, depois do merge de `main` com a #9: `npm run check` com 1.345 testes, e o e2e com 14 (2 do smoke da #9 e 12 da #6). O Python 3.9.9 local reproduz a saída.
- **A verificação adversarial**, feita por um revisor independente num clone da branch: as 388 operações, mandadas com 40 seeds, respondem um 2xx declarado, e só as 13 rotas sombreadas caem no handler errado. O `check:all` passa com o `PYTHONHASHSEED` padrão e com outros dois.

### Decisões tomadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md): uma fonte por área, com a origem e o sha256 de cada documento.
- [0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md): um módulo de recursos por área e o status 2xx documentado.
- [0006: DTOs como interfaces TypeScript](../decisions/0006-dtos-as-typescript-interfaces.md): 459 interfaces e uma regra só de pasta.
- [0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md): o seed e o `requestId` comuns em `src/mocks/`.
- [0008: A toolchain](../decisions/0008-toolchain.md): o Prettier dos geradores lê só o `.prettierignore`.
- A branch nasceu antes do merge da #5, pela resposta nova do dono à pergunta 4, na #6.

### Patterns aplicados ou criados

- [Gerar e conferir](../knowledge/patterns/generate-and-check.md): o commit dos geradores e o da saída separados; o da saída passou a levar a linha escrita à mão que a importa, quando ela muda de lugar.
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md), agora por área.
- [A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md), [Factory com overrides](../knowledge/patterns/factory-with-overrides.md) e [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md).
- [Mover as pastas geradas sem o gerador](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md): "todo commit compila" decidiu a ordem dos commits.

### Aprendizados / surpresas

- **Medir a causa antes de corrigir.** O plano atribuía o `check:all` defasado à pasta ser oculta, e a causa era o `.gitignore`. Renomear a pasta também passava, mas deixaria a pasta temporária fora do `.gitignore` por um motivo errado.
- **A ordem dos commits do plano não compilava.** A ligação escrita à mão ia no commit dos geradores, onde importaria pastas que só existem depois da regeneração. Ela foi para depois da saída, e a linha de `src/main.ts` que importa o seed foi junto com a saída.
- **Os documentos repetem nomes.** 7 schemas e 4 tags aparecem em mais de um, e as áreas separadas guardam cada um.
- **O e2e lê a API interna do roteador do Express** (`router.stack`), como o teste que a #8 planeja. Uma troca de versão do Express pode quebrá-lo, e ele falha em vez de passar em vazio.
- **A verificação adversarial achou o que os checks não viam.** Três formas de schema saem diferentes do documento (um array de topo, uma resposta string e os headers de resposta), e isso foi para a #24. Um corpo acima de 100 KiB responde 413, o que já existia, e foi para a #25. O e2e contava só os métodos que o próprio gerador trata, e passou a contar os oito do OpenAPI em `4ed897b`. O `check:all` e o e2e passavam com as três formas erradas: provar que a saída é a do gerador não prova que ela é a do documento.
- **A #9 entrou em `main` durante a revisão, e o merge tocou 19 arquivos.** Quase todos eram de contexto, porque as duas PRs corrigiram as mesmas citações de linha do README, do `src/main.ts` e do `src/app.module.ts`. Resolver o texto não bastou: as citações foram conferidas de novo contra a árvore mesclada. Nas ADRs, uma nota que prendia as citações a um commit deu lugar a um prefixo por citação, como a #9 já fazia.
- **Um teste intermitente, sem relação com a #6.** Com a máquina carregada, dois casos de `test/scripts/check-context.spec.ts` estouram o timeout padrão de 5 s do vitest, e o processo filho que eles esperam tem 30 s. Isso foi para a #23.

---

## 2026-09-26: Nada sai da máquina por padrão, e as sobras do starter saíram (#9)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **A telemetria saiu.** O `@nestjs/observe` saiu do `AppModule`, do `src/main.ts` e das dependências. A guarda `test/runtime-defaults.spec.ts` falha se ele voltar ao `package.json` ou a um import em `src/`.
- **O servidor escuta em loopback.** O endereço vem de `listenAddress(process.env)`, com `HOST` padrão `127.0.0.1` e `PORT` padrão 3000. Uma variável vazia conta como ausente.
- **As sobras do starter saíram.** O Hello World deu lugar a um smoke e2e: `GET /rest/asset/v1/folders.json` responde 200 com o envelope, e `GET /` responde 404. Também saíram o `deploy`, o `@nestjs/mau` e o boilerplate do README. O pacote virou `marketo-sandbox`, e o lockfile foi regenerado com o faker como dependência de runtime.
- **O `format:check` entrou no `npm run check`,** logo depois do lint. Ele cobre `src`, `test` e `scripts`, o mesmo escopo do `format`.
- **O CI e o fluxo rodam o e2e sem `OBSERVE_ENDPOINT`.** O teste de drift que casava o endereço saiu, e o de paridade passou a exigir o passo `e2e` sem `env`.

### Números medidos

- `npm run check`: exit 0, com 1.345 testes em 8 arquivos. O lint não deu nenhum aviso (antes, 1 em `src/app.module.ts:16`), e o `format:check`, o typecheck, o `check:context` e o build passaram.
- `npm run test:e2e`, sem variável nenhuma: 2 testes passaram. Com o caminho do smoke trocado por um inexistente, o teste falha com 404.
- `npm install --package-lock-only`, rodado duas vezes: nenhuma mudança na segunda. O lockfile foi de 395 para 348 entradas (`git diff --numstat 610e101 -- package-lock.json`: +6/−683), e o `npm ci` instala 305 pacotes em vez de 352.
- `node dist/main` por 75 s, com um preload que registra toda conexão: escuta só em `127.0.0.1`, 8 threads (13 em `610e101`), nenhuma worker thread e nenhuma conexão para fora do loopback. O `/api-json` foi de 221 para 220 operações.
- Em `610e101`, com a telemetria apontada para um listener local: 2 `POST /applications/telemetry` em 20 s com 5 GETs, e 1 por minuto com o app ocioso, com as chaves vazias.

### Decisões tomadas

- [0010: O mock só fala com a própria máquina por padrão](../decisions/0010-loopback-only-by-default.md): o Observe foi removido em vez de virar opt-in, e o `HOST` tem padrão `127.0.0.1`. Isso fecha a decisão em aberto do project intent.
- As ADRs 0002, 0004, 0005, 0006, 0007 e 0008 ganharam uma linha `Atualizado`, com as citações que a mudança deslocou.

### Patterns aplicados ou criados

- [Padrão com `??` para uma variável de ambiente](../knowledge/anti-patterns/nullish-default-for-an-env-var.md), novo.
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md): a lista de arquivos escritos à mão mudou.
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md): o `HOST` entrou no que o lite-campaign consome.

### Aprendizados / surpresas

- **O contorno do CI não fazia o que dizia.** O e2e de um teste nunca mandou telemetria, porque o `TestingModule` não recebe o `instrument`. E a porta 9 funcionava porque o `fetch` a recusa como "bad port", sem abrir socket.
- **Um preload de rede vê as worker threads,** ao contrário do que o plano supunha. Ele serviu de prova na Verificação.
- **`??` não protege uma variável vazia.** `HOST=` com `??` escutaria em todas as interfaces, que é o contrário do padrão.
- **Uma linha citada anda sem avisar.** Tirar o cabeçalho do README, 47 pacotes do lockfile e as linhas do Observe fez a #9 trocar 52 citações `arquivo:linha` em 14 arquivos de contexto, e o `check:context` não confere essas linhas. A varredura comparou o conteúdo de `610e101` com o da branch. A primeira passada deixou 4 citações para trás, e a revisão adversarial as achou. Uma citação que descreve um commit antigo leva o SHA na frente (`fb4a804:src/main.ts:7`), para não andar de novo.
- **Planos em paralelo.** Enquanto uma sessão media para escrever o plano, outra publicou um plano da #9 e o dono o aprovou. Reler o timeline da issue logo antes de postar evita um `# Plano` que revogaria o Approve.
- **Telemetria na instalação.** O `@scarf/scarf` manda um evento a cada `npm ci`, e isso ficou na #20.

---

## 2026-09-25: Plano publicado passa a aguardar validação (#17)

**Fase**: Learn
**Tipo**: Decision

### O que foi construído / corrigido

- Ao publicar um plano completo numa issue em `needs-triage`, o agente troca essa label por `ready-for-human` no mesmo passo. O dono continua sendo o único a escrever `# Owner Approve` e aplicar `ready-for-agent`.
- A regra agora aparece no `AGENTS.md`, no fluxo, na ADR 0001, no pattern do gate, no glossário, no contrato `agentPlanLabelTransition` e na mensagem que o gate imprime. Esta PR separa a documentação compartilhada dos hooks da #5, que ainda irão chegar.

### Números medidos

- `npm run check`: 1.338 testes passaram; lint, typecheck, `check:context` e build passaram. `check:context` leu 38 arquivos, 489 links internos, 30 blocos Status, 9 decisões no índice e 7 entradas do changelog.
- `OBSERVE_ENDPOINT=http://127.0.0.1:9 npm run test:e2e`: 1 teste passou.

### Decisões tomadas

- A transição de triagem para validação é do agente quando ele publica o plano. O Approve e a aplicação de `ready-for-agent` permanecem atos do dono ([ADR 0001](../decisions/0001-context-mesh-in-the-repository.md)).

### Patterns aplicados ou criados

- [O gate do loop](../knowledge/patterns/loop-gate.md): sua mensagem distingue os dois papéis.

### Aprendizados / surpresas

- Os documentos gerais do Context Mesh já estavam em `main`. Só a regra mais recente precisava de PR própria; o intent ficou na branch da #5, e os hooks da #5 ainda irão chegar. A revisão do Copilot mostrou que a mensagem do gate e o contrato de labels precisavam mudar juntos.

---

## 2026-09-25: Registro retroativo das decisões, dos padrões e dos erros de antes do loop (#4)

**Fase**: Learn
**Tipo**: Decision

### O que foi construído / corrigido

- **Seis ADRs retroativas.** As ADRs de 0004 a 0008 são `Accepted`, porque o código já é a decisão, e a 0009 fica `Proposed` até a primeira sub-issue da Track A que construir comportamento. Todo racional que o histórico não registra está marcado "(inferido; confirmar)", para o dono confirmar ou corrigir.
- **Seis patterns novos:** gerar e conferir, a fronteira do código gerado, a forma de um módulo de recurso, factory com overrides, revisão antes do merge e revisão classificada por risco.
- **Quatro anti-patterns do histórico:**
  - editar código gerado à mão (`5cc5e09`);
  - mover as pastas geradas sem o gerador (`a19d9d3`, `e7a0bb6` e `b91681a`);
  - mensagem de commit que diz menos do que o commit faz;
  - rota literal depois de uma rota com parâmetro (#8).
- **O glossário e o `CODING_STANDARDS.md`.** O `CODING_STANDARDS.md` só tem links, para cada pattern e cada anti-pattern. O `AGENTS.md`, o guia do Context Mesh, o fluxo e o project intent passam a apontar para os arquivos novos.
- **Os critérios ao vivo da #3 e da #13** foram marcados, cada um com a própria evidência: a primeira auditoria de `main`, e o comentário de evidência na #13.
- **Um teste de drift do harness mudou de invariante.** Antes da #4, ele garantia que os números de decisão prometidos à #4 estavam livres. Agora a #4 ocupa esses números, e o teste garante que cada um existe. Por isso a PR é `HIGH`, e não `NORMAL` como no plano.

### Números medidos

Medidos numa cópia de `origin/main` tirada com `git archive`, fora do worktree. O `tsc` foi rodado em cada commit pré-loop.

- **O Swagger.** sha256 `ced6c339f60e71f30f4a929ce04e748c814ca2e8350611b946af3267cb962eaf`, com 255 definições, 220 operações, 186 caminhos e 23 tags (contados com node).
- **Os geradores.** O `--check` sai com 1 nos três geradores e acusa 255, 46 e 259 arquivos (definições, resources e factories). Gerados de novo, os 255 arquivos de definições e os 259 de factories saem idênticos aos commitados, só nas pastas antigas. Os 46 resources diferem só no prefixo dos imports.
- **As rotas sombreadas.** Com um build `tsc` servido em 127.0.0.1 e cada método de service trocado por um que devolve o próprio nome, as 11 rotas literais sombreadas caem no handler da rota `:id`. `GET form/fields.json` e `GET form/programMemberFields.json` só escapam porque o `FormFieldsModule` é importado antes do `FormsModule`.
- **O `tsc` nos commits.** Nenhum commit anterior a `fb4a804` passa no `tsc`. Erros TS2307 (módulo não encontrado): 123 em `a19d9d3`, 165 em `e7a0bb6`, 86 em `5cc5e09` e 86 em `0ef242d`.
- **O Swagger UI.** O documento que o `SwaggerModule` monta sobre o `AssetResourcesModule` tem 186 caminhos e 0 schemas. O que o app serve em `/api` tem também o `GET /` do starter, e fica com 187.
- **O seed.** Chamando os services direto: duas chamadas seguidas ao mesmo método diferem, a primeira se repete depois de semear de novo, e uma chamada a outro método antes dela muda o resultado.

### Decisões tomadas

- [0004: O Swagger como fonte única, com o código gerado commitado](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md): a cópia `ced6c339…` gera as rotas, os DTOs e as factories, e a saída é commitada e conferida com `--check`.
- [0005: NestJS sobre Express, com um módulo por tag](../decisions/0005-nestjs-express-one-module-per-tag.md): 23 módulos, rotas com o caminho inteiro e services que devolvem factories.
- [0006: DTOs como interfaces TypeScript](../decisions/0006-dtos-as-typescript-interfaces.md): 255 interfaces e nenhuma validação em runtime.
- [0007: Factories faker com overrides e seed](../decisions/0007-faker-factories-with-overrides-and-seed.md): `makeX(overrides)`, com o seed por variável de ambiente.
- [0008: A toolchain](../decisions/0008-toolchain.md): npm, TypeScript 6, oxlint, prettier, vitest, `nest build` e os geradores em Python.
- [0009: Comportamento ao lado do código gerado, nunca dentro](../decisions/0009-behaviour-beside-generated-code.md): `Proposed`.

### Patterns aplicados ou criados

- [Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [A fronteira do código gerado](../knowledge/patterns/generated-code-boundary.md)
- [A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)
- [Factory com overrides](../knowledge/patterns/factory-with-overrides.md)
- [Revisão antes do merge](../knowledge/patterns/review-before-merge.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

### Aprendizados / surpresas

- **Medir em vez de inferir.** Quatro pontos que os rascunhos marcavam como inferência foram medidos: as rotas sombreadas, o build quebrado entre os commits, o Swagger UI sem schemas e o seed, que fixa a sequência e não cada resposta. Duas inferências estavam erradas. O `npm ci --omit=dev` ainda instala o faker, porque o npm recalcula as flags de dev a partir do `package.json`. E 33 das 34 respostas "sem envelope" têm `success` e `requestId`.
- **A mensagem de commit não é fonte.** Quatro dos nove commits pré-loop fazem mais, ou outra coisa, do que dizem. O registro só saiu lendo cada diff.
- **O gerador e a saída já divergiam no primeiro commit.** Em `0c8e760`, os geradores emitiam imports com sufixo `.js`, e nenhum arquivo commitado os tinha.
- **A ordem de import dos módulos também decide rotas.** Duas rotas de `form-fields` só não caem em `forms` pela ordem alfabética dos imports, e a #8 não as listava.
- **Depois do merge da #13, o refresh também ficou `action_required`.** Quatro runs do `Atualiza vínculo com issue` por `workflow_run`, com o Copilot como ator, pediram aprovação e não rodaram. É o mesmo limite do sinal (ADR 0003): depois da revisão do Copilot, o veredito é renovado à mão.

---

## 2026-09-25: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge (#13)

**Fase**: Learn
**Tipo**: Feature

### O que foi construído / corrigido

- **Gate, dois passos novos em modo CI** (`copilot-review` e `review-threads`). Eles bloqueiam fora de draft.
  - `copilot-review` exige uma revisão do Copilot no commit que é a cabeça da PR. A identidade é o `Bot` com `databaseId` 175728472, nunca só o login, porque existe uma organização com esse nome. Os estados aceitos são `COMMENTED` e `APPROVED`, e uma revisão que falhou não conta. Outra revisão do Copilot pedida e ainda a caminho (`reviewRequests`) também bloqueia, mesmo com uma revisão na cabeça.
  - `review-threads` exige zero threads abertas, de qualquer autor, inclusive as desatualizadas.
  - As mensagens dizem como pedir a revisão de novo e como renovar o veredito. Os comandos delas põem entre aspas simples, para o shell, um valor que ele leria como sintaxe (`shellWord`).
- **Re-disparo em duas etapas:**
  - o `Sinal de revisão` (`review-signal.yml`) roda o YAML da PR, não tem permissão nenhuma e só avisa;
  - o refresh roda de `main` via `workflow_run` e `workflow_dispatch` (com `--ref main`) e re-executa o `issue-link` da cabeça.
- **Auditoria de `main`:** a partir de 25/09 às 12:00 UTC, um merge sem revisão do Copilot na cabeça antes do merge, ou com thread aberta até o merge, fica fora do loop.
- **Decisão e docs:** a nova [ADR 0003](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md); o fluxo da PR em `workflow.md` e no `AGENTS.md` (draft, monitor de CI ligado, sair de draft só com o Learn, esperar o Copilot, responder e só então resolver, renovar o veredito); e o template de PR pedindo essa evidência.

### Números medidos

- `npm run check`: 1.320 testes em 8 arquivos verdes; `check:context` sem problemas; build OK.
- 160 regras revertidas uma a uma numa cópia fora do worktree nas rodadas de construção, e mais 57 na de correção. Cada reversão fez algum teste falhar.
- O gate novo, rodado sobre os dados reais: a PR #14 fica verde (revisão na cabeça `2f02ce0`, 0 de 3 threads abertas), e as PRs #10 e #11 ficariam bloqueadas.

### Decisões tomadas

- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md) (Accepted).
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): as camadas e os limites novos (resolver uma thread não dispara evento; o sinal pode ser removido por uma PR; cada resposta numa thread é uma revisão).

### Patterns aplicados ou criados

- [O gate do loop](../knowledge/patterns/loop-gate.md) e [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) (atualizados)

### Aprendizados / surpresas

- **Um revisor que falha continua "revisando".** O Copilot posta uma revisão `COMMENTED` na cabeça quando dá erro, quando a cota acaba ou quando não consegue ler os arquivos. Só o texto diz que nada foi revisado, e isso só apareceu procurando revisões reais em outros repositórios.
- **Responder numa thread também é uma revisão.** Isso conta no limite de página e dispara o sinal.
- **"Pedir o refresh" não é "ter o veredito".** Um comando assíncrono retorna antes do resultado. Em regra de merge, só vale o que se espera terminar.
- **Todo push depois da revisão exige outra revisão.** O Learn tem de estar commitado antes de a PR sair de draft.
- **O REST não mostra o pedido de revisão ao Copilot.** Com a revisão pedida e pendente na PR #15, o `requested_reviewers` do REST veio vazio. Só o `reviewRequests` do GraphQL o mostra, como `Bot` com o `databaseId` 175728472.
- **O Copilot resolve sozinho uma thread que um push deixou desatualizada.** Na PR #15, a thread do corpo vazio foi resolvida pelo Copilot, sem resposta, logo depois do push que a corrigia. O gate a vê resolvida; a resposta com o SHA continua sendo do agente.
- **Num `run:` de uma linha só, o YAML corta o comando no ` #`.** A primeira execução do `Sinal de revisão`, na PR #15, recebeu `echo "Revisão na PR` e falhou. O teste de paridade lia a linha crua e não viu. Agora o passo usa um bloco literal, e um teste recusa ` #` em qualquer `run:` de uma linha só.

---

## 2026-09-25: Os comentários abertos do Copilot nas PRs #10 e #11 (#12)

**Fase**: Learn
**Tipo**: Bug Fix

### O que foi construído / corrigido

Cada uma das 7 threads do Copilot deixadas abertas nas PRs #10 e #11 foi verificada contra o `main`, reproduzindo o cenário quando dava. Duas procediam, três procediam em parte e duas não procediam.

- **Labels no gate.** O gate lê até 100 labels, com `totalCount`. Quando há mais do que foi lido, `kind` e `state-label` falham fechado. O `gh` falso das specs exige `totalCount` e corta as conexões por `first`/`last`.
- **Outra branch da mesma issue.** Só a própria branch e a cópia dela em `origin` ficam isentas no `stacked`. Qualquer outra ref da mesma issue que compartilha histórico não publicado bloqueia (resposta 1 do dono). A mensagem depende da direção:
  - quando a outra branch não tem nada que esta não tenha, manda apagar, e só com os comandos das refs que existem;
  - quando ela tem trabalho próprio, manda juntar tudo numa branch antes de apagar a outra, e nunca sugere `git branch -D`.
- **Referências de fechamento na auditoria.** A auditoria lê até 100. Uma página incompleta, ou uma de checks incompleta, deixa o merge fora do loop com o motivo verdadeiro, em vez de interromper a auditoria para sempre.
- **O plano é lido como o GitHub mostra.**
  - Uma caixa dentro de bloco de código (inclusive dentro de item de lista) ou de comentário HTML não conta como critério.
  - Um título dentro deles não é seção.
  - Um texto só em comentário não conta como conteúdo nem como citação da branch.
  - Um nome com sufixo (`feature/12-x.old`) não cita `feature/12-x`.
  - Os blocos de código seguem o CommonMark.
- **`check:context`.** Três leituras erradas de título com sublinhado (setext) foram corrigidas: linha que só parece lista, título vazio e título só de código. Depois da revisão do Copilot na PR #14, um comentário HTML aberto numa linha anterior passou a fechar no primeiro `-->` da linha, mesmo entre crases, como o GitHub renderiza.
- **Autoria dos atos.** O código não muda. Os docs e um teste passam a dizer que só o Approve e a label exigem o dono. A retirada, um título quase-Approve, `# Plano`, edição, remoção, reabertura e uma nova aplicação da label por outro ator cancelam, venham de quem vierem.
- **Comentários que não procediam.** O YAML do `issue-link` e o da auditoria citam a documentação: o `pull_request_target` usa o branch padrão desde 08/12/2025, e `queue: max` está documentado desde 07/05/2026.
- **Docs.** Os templates copiáveis do guia ganharam o bloco Status, e a entrada da #3 no changelog agora diz 113 links.

### Números medidos

- `npm run check`: 909 testes em 8 arquivos verdes; `check:context` sem problemas em 17 arquivos, com 123 links internos; build OK.
- Cada correção tem um teste que falha quando ela é revertida. Isso foi medido revertendo cada uma numa cópia fora do worktree, em quatro rodadas de revisão e verificação.
- Os corpos reais das issues #1 a #5, #12 e #13 dão os mesmos critérios, seções e citações com o parser antigo e o novo.

### Decisões tomadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): uma página incompleta na auditoria é um achado, não uma interrupção.

### Patterns aplicados ou criados

- [O gate do loop](../knowledge/patterns/loop-gate.md) e [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) (atualizados)

### Aprendizados / surpresas

- **Mergear antes da revisão do Copilot deixa threads abertas sem ninguém ver.** As PRs #10 e #11 foram mergeadas uns 3 minutos antes de a revisão chegar. Daqui em diante a PR espera a revisão na cabeça, e a #13 põe isso no gate.
- **Um revisor automático também erra.** Dois dos 7 comentários descreviam o GitHub de antes de mudanças documentadas. A resposta a eles é a fonte, não uma mudança de código.
- **A correção sugerida nem sempre fecha o buraco.** A de "outra branch da mesma issue" sozinha deixava o gate aberto, porque os commits dos dois lados citam `#N`.

---

## 2026-09-25: CI de qualidade, auditoria de main e refresh do vínculo (#3, PR #11)

**Fase**: Learn
**Tipo**: Process

### O que foi construído / corrigido

- **`npm run check`** agrega lint, `typecheck` (script novo), testes, `check:context` e build. O `Qualidade / check` roda esse agregado e, num passo à parte, o e2e com `OBSERVE_ENDPOINT` apontado para loopback, para que o `ObserveModule` não mande telemetria do runner (#9). No `main`, cada SHA tem o seu grupo de concorrência, então nenhum commit de `main` fica sem veredito por cancelamento.
- **`npm run check:context`** (`scripts/check-context.mjs`) recusa:
  - link relativo ou âncora quebrados, inclusive âncora no próprio arquivo;
  - arquivo fora do layout;
  - título sem o tipo e os dois-pontos;
  - bloco Status ausente, fora do fim ou com token inválido, e status declarado fora dele;
  - índice de decisões que diverge dos arquivos;
  - título de entrada do changelog fora do formato;
  - caminho absoluto de máquina.

  O formato vem de `scripts/loop-sections.mjs`, não de uma segunda cópia.
- **Auditoria de `main`** (`Auditoria de main`, `scripts/audit-main.mjs`). Roda a cada push em `main`, uma vez por dia e à mão. O job tem dois passos: `Julgar` julga o intervalo e abre as issues; `Veredito` deixa a run vermelha.
  - **O intervalo** vai do topo da última run cujo `Julgar` terminou até o topo atual. Quando o topo antigo saiu do clone, a reescrita é detectada pelo compare do GitHub.
  - **Um merge está no loop** quando vem de uma PR que fecha uma issue e teve `Vínculo com issue / issue-link` (do evento `pull_request_target`) e `Qualidade / check` verdes antes do merge.
  - **O resto abre sozinho uma issue** `bug` + `needs-triage` chamada "Mudança em main fora do loop: <sha7>", ou comenta na issue de mesmo título, e a run fica vermelha (resposta 2 do dono na #3).
  - **A linha de base é `8d4662f`**, o merge da #2 e a exceção de bootstrap.
- **Refresh do `issue-link`** (`Atualiza vínculo com issue`, `scripts/refresh-issue-link.mjs`). Eventos de label, comentário, fechamento e reabertura na issue re-executam o `issue-link` das PRs abertas que a fecham. Uma run em andamento é esperada antes do re-run.
- **Tokens de pular CI** (`skipCiTokens` e o trailer `skip-checks: true`) passaram a ser proibidos no título, no corpo e nos commits de uma PR, porque a mensagem do merge é o título mais o corpo da PR.

### Números medidos

- `npm run check`: 737 testes em 8 arquivos verdes; `check:context` sem problemas em 16 arquivos, com 113 links internos; build OK.
- `OBSERVE_ENDPOINT=http://127.0.0.1:9 npm run test:e2e`: 1 teste verde, cerca de 1 s.
- **Na PR #11, a primeira execução real do `Vínculo com issue / issue-link`:** evento `pull_request_target`, gate de `main` rodando contra a cabeça da PR, verde em 8 s. O `Qualidade / check` ficou verde em 1 min num runner limpo, com o e2e incluído.
- Cada correção das revisões tem um teste de regressão que falha quando ela é revertida. Foram mais de 100 mutações, todas capturadas, feitas numa cópia fora do worktree.

### Decisões tomadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): a camada 1 ficou completa (qualidade e refresh) e a camada 6 existe, com os limites medidos.
- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md): o que a auditoria lê foi corrigido, e as pastas `agents/` e `evolution/history/` passaram a ter regra de layout.

### Patterns aplicados ou criados

- [O gate do loop](../knowledge/patterns/loop-gate.md) e [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) (atualizados)
- [Limite da auditoria tirado do evento](../knowledge/anti-patterns/audit-bound-from-the-event.md) (anti-pattern criado)

### Aprendizados / surpresas

- **O limite de uma auditoria sai do último estado julgado, não do evento.** Foram necessárias três rodadas para fechar as variações: push sem run, run interrompida, reescrita fora do clone e sequência longa de runs sem julgamento.
- **Um check casado só pelo nome pode ser falsificado pela própria PR.** Um workflow `pull_request` com o mesmo nome produzia um verde falso. O `issue-link` agora só vale vindo de `pull_request_target` e do arquivo `.github/workflows/issue-link.yml`.
- **A mensagem do merge carrega o título e o corpo da PR.** Um `[skip ci]` citado ao documentar a regra desligaria a auditoria do próprio merge.
- **Ainda não verificado ao vivo:** a consulta GraphQL de checks da auditoria, e se o `GITHUB_TOKEN` consegue re-rodar uma run de `pull_request_target`. A primeira execução real deles é a PR e o merge desta issue.

---

## 2026-09-24: Loop issue-first com gate e vínculo PR↔issue (#2, PR #10)

**Fase**: Learn
**Tipo**: Process

### O que foi construído / corrigido

- **Context Mesh no repositório.** O guia (`context/README.md`), o índice de decisões e as ADRs [0001](../decisions/0001-context-mesh-in-the-repository.md) e [0002](../decisions/0002-soft-enforcement-on-github-free.md), o project intent, o intent desta feature, dois patterns e um anti-pattern.
- **O gate do loop** (`npm run gate`, `scripts/gate.mjs`). Os contratos têm uma fonte única, `scripts/loop-sections.mjs`, que o gate, os forms, o CI e os testes importam. A issue é lida por GraphQL. O gate tem um modo local, que degrada sem rede e grava o cache, e um modo CI, que falha fechado.
- **Os três defeitos do gate do lite-campaign, corrigidos:**
  - brunohab/lite-campaign#124: o Learn exige um título de entrada novo;
  - brunohab/lite-campaign#122: o `stacked` vê toda ref que compartilha commits fora do `origin/main`, inclusive `claude/*` e o `main` local à frente;
  - brunohab/lite-campaign#103: exatamente uma label de estado, e um `gh` falso estrito.
- **CI:**
  - `Vínculo com issue / issue-link` roda em `pull_request_target`: o YAML e o gate vêm de `main`, e a PR entra só como dados;
  - `Qualidade / check` roda lint e testes.
- **Issue forms** em pt-BR, com rótulos iguais aos títulos que o gate lê, e o **template de PR**, que começa com `Closes #`.
- **Roteamento e loop:** `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`) e `docs/development/workflow.md`, com o loop de 9 passos, o encaixe do plan mode, o cookbook do `gh`, as labels e as regras de merge.
- **Configurações do repositório**, aplicadas com o OK do dono na #2: só merge commit, a branch é apagada no merge, e o merge commit leva o título e o corpo da PR. As labels `needs-triage`, `needs-info`, `ready-for-human` e `ready-for-agent`.

### Números medidos

- `npx vitest run`: 418 testes em 5 arquivos, todos verdes.
- CI `Qualidade / check` na PR #10: verde em 46 s num runner limpo (`npm ci`, lint, 418 testes, árvore limpa).
- `node scripts/gate.mjs --json --no-cache` na branch `feature/2-loop-minimo`: `open: true`, `verified: true`, `blocked: []`. O Approve do dono (2026-09-24T22:08:39Z) e a label aplicada depois dele (22:08:53Z) foram lidos ao vivo.
- Cada correção feita depois das revisões tem um teste de regressão que falha quando ela é revertida. Isso foi medido revertendo cada correção numa cópia fora do worktree.

### Decisões tomadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md): o plano vive na issue, o Approve é do dono, uma issue vira uma branch que vira uma PR, o merge é por merge commit e não existe lane sem issue.
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): as camadas, o que cada uma cobre e os limites. Os hooks chegam com a #5, e a auditoria de `main` e o refresh do check, com a #3.

### Patterns aplicados ou criados

- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) (criado)
- [O gate do loop](../knowledge/patterns/loop-gate.md) (criado)
- [Dublê de teste estrito na camada errada](../knowledge/anti-patterns/test-double-strict-on-the-wrong-layer.md) (anti-pattern criado)

### Aprendizados / surpresas

- **Revisão adversarial rende.** Três rodadas de revisão e verificação acharam mais de 30 defeitos reais e distintos num gate que já passava em todos os testes. Os mais graves: o `stacked` abria logo depois do corte, e o `gh` falso respondia campos que o gate não tinha pedido. Toda regra que decide abrir o gate precisa de um caso que falha quando ela é removida.
- **Em dúvida, bloquear.** Uma retirada de Approve escrita com uma letra diferente passava em silêncio. Agora qualquer título que mencione "approve" e não seja o Approve exato cancela o Approve em pé, e o dono reaprova.
- **`updatedAt` não serve para detectar edição.** Ele muda com label e com comentário. O que serve é `lastEditedAt`, lido por GraphQL.
- **Worktrees do Claude Code nascem do HEAD do checkout principal**, não de `origin/main`. Toda branch é cortada de `origin/main`, e o upstream que aponta para `origin/main` é removido.
- **A PR ficou maior que o previsto**, com cerca de 8,5 mil linhas em vez de 3 mil, quase tudo em testes. O plano deveria estimar os testes de um gate à parte.

---

## 2026-09-24: O mock gerado do Swagger, antes do loop (#4)

**Fase**: Learn
**Tipo**: Retroactive

### O que foi construído / corrigido

Nove commits entraram direto em `main` no mesmo dia, sem issue e sem PR. A #4 os reconstruiu pelo diff, um a um.

- **`0c8e760` Initial commit.** O starter NestJS, o Swagger de assets (`docs/marketo-swagger-asset.json`) e os geradores de definições e de resources. Traz 255 DTOs em `src/asset-definitions/` e 23 módulos de recurso cujos services lançam `NotImplementedException`.
- **`01ee283`.** Os scripts npm `generate:factories`, `check:factories`, `generate:all` e `check:all`; os de definições e de resources já vinham em `0c8e760`. Também move o `@faker-js/faker` para `dependencies`, acrescenta o `@nestjs/swagger` e liga `ignoreDeprecations: "6.0"`.
- **`a967f26`.** O gerador de resources passa a emitir services que devolvem factories e módulos com `exports`. Os geradores passam a importar `marketo_codegen`, que ainda não existe.
- **`a19d9d3` e `e7a0bb6`.** Movem os 255 DTOs para `src/asset/asset-definitions/` e os reformatam, sem mudar os geradores.
- **`5cc5e09`.** Os `exports` dos módulos e as chamadas às factories, que o gerador de `a967f26` já emitia, e o prefixo `../../` dos imports, que nenhuma versão dele emite, tudo sem rodar o gerador.
- **`0ef242d`.** O gerador de factories e o `marketo_codegen.py`.
- **`b91681a`.** As 255 factories faker, o `seed.ts` e o `request-id.ts`, em `src/asset/asset-mocks/`.
- **`fb4a804`.** O Swagger UI em `/api` e o `seedMockData()` no boot. É o primeiro commit que passa no `tsc`.

### Decisões tomadas

- [0004](../decisions/0004-swagger-as-single-source-with-committed-generated-code.md), [0005](../decisions/0005-nestjs-express-one-module-per-tag.md), [0006](../decisions/0006-dtos-as-typescript-interfaces.md), [0007](../decisions/0007-faker-factories-with-overrides-and-seed.md) e [0008](../decisions/0008-toolchain.md), registradas pela #4.

### Aprendizados / surpresas

- **Mover as pastas geradas sem o gerador** deixou os geradores escrevendo no layout antigo, e o `npm run check:all` não passa desde então (#7; [anti-pattern](../knowledge/anti-patterns/moving-generated-folders-without-the-generator.md)).
- **A ordem das rotas vem do Swagger.** Por isso 11 rotas literais ficaram depois de uma rota `:id` que as engole (#8; [anti-pattern](../knowledge/anti-patterns/literal-route-after-param-route.md)).
