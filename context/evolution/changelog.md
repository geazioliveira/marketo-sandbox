# Changelog

Uma entrada por mudança mergeada, da mais nova para a mais antiga, escrita no passo Learn da branch que fez a mudança. O formato está no [guia do Context Mesh](../README.md). O que veio antes do loop (de `0c8e760` a `fb4a804`) ganha uma entrada retroativa com a #4.

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

- `npm run check`: 1.291 testes em 8 arquivos verdes; `check:context` sem problemas; build OK.
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
