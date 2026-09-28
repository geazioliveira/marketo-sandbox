# Feature: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge

## Declaração de intenção

O dono pediu, em 2026-09-25: **"para dar merge precisamos adicionar no gate que os comentários do copilot precisam existir e precisam estar verdes também, não podemos ter comentários abertos ou não resolvidos"**.

As PRs #10 e #11 foram mergeadas antes de a revisão do Copilot chegar, e ficaram com 7 threads abertas (tratadas na #12). Esta feature transforma em gate o que a PR #14 fez à mão:
- uma revisão do Copilot no commit que é a cabeça da PR;
- zero threads de revisão abertas, de qualquer autor.

A auditoria de `main` registra o merge que chegar sem as duas coisas.

## Critérios de aceite

- [x] `scripts/loop-sections.mjs` guarda os contratos, e o gate, a auditoria e os testes usam essa mesma fonte (os hooks da #5 vão usá-la também):
  - `copilotReviewer` (`Bot`, `databaseId` 175728472, login legível);
  - o login de pedido;
  - os estados aceitos (`COMMENTED`, `APPROVED`);
  - as funções puras `copilotReviewOn` e `openThreads`.
- [x] O modo CI do gate ganha os passos `copilot-review` e `review-threads`. Eles bloqueiam fora de draft, e no modo local dizem "só no modo CI".
  - `copilot-review` exige uma revisão do Copilot, não dispensada, cujo `commit.oid` é a cabeça da PR, e explica como pedi-la.
  - `review-threads` exige zero threads não resolvidas, inclusive as desatualizadas, e lista `path:line` e o link de cada uma.
  - Uma página lida pela metade fica `unchecked` e bloqueia.
- [x] O re-disparo é confiável:
  - `review-signal.yml` ("Sinal de revisão") roda em `pull_request_review` (`submitted`, `dismissed`) com `permissions: {}` e só sinaliza, até a #30;
  - `issue-link-refresh.yml` ganha `workflow_run` desse sinal, até a #30, e `workflow_dispatch` com o número da PR;
  - o `refresh-issue-link.mjs` ganha um modo PR.
- [x] A auditoria de `main` deixa um merge fora do loop quando não houve revisão do Copilot na cabeça antes do merge, ou quando alguma thread aberta até o merge continua não resolvida na hora da auditoria.
- [x] Nova ADR 0003 (revisão na cabeça e zero threads como condições de merge). A ADR 0002 ganha as camadas e os limites. O `docs/development/workflow.md` e o `AGENTS.md` descrevem o fluxo:
  1. abrir a PR em draft;
  2. ligar o monitor de CI do app;
  3. sair de draft só com o Learn commitado;
  4. esperar o Copilot e pedir de novo a cada push novo;
  5. responder cada thread antes de resolvê-la;
  6. renovar o veredito.
- [x] Cada regra tem teste, e cada teste falha quando a regra é revertida.
- [x] A PR desta issue espera a revisão do Copilot na cabeça e tem zero threads abertas no merge. Os passos novos só rodam a partir de `main` na PR seguinte. A PR #15 foi mergeada em `7a18d31` com a revisão do Copilot na cabeça `1eb08fd` e 0 de 8 threads abertas ([comentário de evidência na #13](https://github.com/geazioliveira/marketo-sandbox/issues/13#issuecomment-5837763326)).
- [x] `npm run check` e o e2e passam, e o gate fica aberto.

## Abordagem técnica

- **Identidade do Copilot.** Ela é casada por `__typename === 'Bot'` e `databaseId`, não pelo login, porque existe uma organização com esse nome.
- **Re-disparo em duas etapas, até a #30.** Um evento de revisão roda o YAML da própria PR, então o sinal não tinha permissão nenhuma até a #30, que o tirou. Quem re-executava o `issue-link` era o refresh, que roda de `main`.
- **Threads resolvidas.** Resolver uma thread não dispara evento nenhum. Por isso o agente renova o veredito à mão depois de resolver, e a auditoria julga as threads na hora dela.
- **Resumo da revisão.** Um achado que aparece só no resumo, sem thread, não é lido pelo gate, porque o formato não é documentado. O agente o trata na PR.

## Perguntas em aberto

Respondidas pelo dono no Approve da #13 (2026-09-25), "seguindo suas recomendações":

1. "Verde" é uma revisão do Copilot na cabeça exata e zero threads abertas.
2. "Review new pushes" ligado, com o fluxo draft → `gh pr ready`. Enquanto a configuração não estiver ligada, o agente pede a revisão de novo a cada push (`gh pr edit <n> --add-reviewer @copilot`).
3. O agente resolve uma thread só depois de responder nela com o SHA da correção, uma issue `#N` ou a evidência. Os hooks da #5 vão fazer isso valer; até lá, é regra escrita.
4. Um achado que aparece só no resumo não entra no gate, e o agente o trata.
5. Não há bypass para quando o Copilot estiver indisponível: se o dono mergear mesmo assim, a auditoria registra.
6. O re-disparo é em duas etapas.
7. Threads de qualquer autor contam.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md), criada nesta issue.

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md) e na [ADR 0003](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md).

Desvios do plano, descobertos nas revisões adversariais e medidos em PRs reais do GitHub:
- **Uma revisão do Copilot que falhou não conta.** Quando o Copilot falha, ele ainda posta uma revisão `COMMENTED` na cabeça, e só o corpo diz que nada foi revisado:
  - "Copilot encountered an error…";
  - "Copilot wasn't able to review…";
  - "Copilot was unable to review this pull request because…", no caso de cota, cobrança ou elegibilidade.

  Sem essa regra, o fim da cota de Copilot do dono deixaria o gate verde sem revisão nenhuma. As três falhas bloqueiam, porque não há bypass. Uma revisão sem corpo, ou com o corpo vazio ou só com espaços, também conta como falha, porque nada nela mostra que o Copilot revisou alguma coisa (achado da revisão do Copilot na PR #15).
- **Página parcial de revisões.** Cada resposta numa thread também é uma revisão, então uma PR longa passa de 100. Uma revisão do Copilot que conta entre as 100 mais recentes basta, porque as mais antigas não a desfazem. A página fica `unchecked` só quando nenhuma das lidas conta. Isso afrouxa o texto do critério sobre "página lida pela metade", da mesma forma que a auditoria já fazia.
- **O veredito fresco antes do merge** era o gate em modo CI rodado na cabeça, ou `gh run rerun` do `issue-link` seguido de `gh run watch --exit-status`, até a [#30](bug-issue-link-red-on-every-pr.md); desde ela, um rerun do `issue-link` não é veredito fresco. Um `gh workflow run` do refresh sozinho não é veredito fresco, porque retorna antes de o refresh rodar. As mensagens do gate dizem como renovar.
- **O `workflow_dispatch` roda a ref disparada,** não `main`. O comando é emitido com `--ref main`, e o job pula um disparo de outra ref. Isso só pega acidentes, porque a cópia do YAML na ref disparada pode tirar a guarda. Não é uma fronteira de confiança, nem precisa ser: só quem tem escrita no repositório dispara um `workflow_dispatch`, e quem tem escrita já pode rodar qualquer workflow por um push numa branch.
- **Pedir a revisão de novo** virou uma regra verificável: depois de cada push, se o timeline não mostra um pedido ao Copilot depois do push, o agente pede.
- **Uma revisão do Copilot a caminho também bloqueia.** O plano pedia que a consulta da PR lesse `reviewRequests`, e a primeira versão do gate não lia; a revisão do Copilot na PR #15 apontou a falta. Agora um pedido pendente ao Copilot (`copilotRequested`, o `Bot` com o `databaseId`) segura o merge mesmo com uma revisão na cabeça, porque as threads da revisão nova ainda não existem, e a mensagem manda esperá-la em vez de pedir outra. Com uma revisão na cabeça e os pedidos lidos pela metade (ou sem `totalCount`), sem o do Copilot entre eles, o passo fica `unchecked`. Medido na PR #15: o GraphQL mostra o pedido pendente, e o `requested_reviewers` do REST vem vazio.
- **A ADR 0003 ficou com o número 0003.** As ADRs retroativas da #4 passam a ser numeradas a partir de 0004, o que é um desvio só de numeração em relação ao plano da #4.

O último critério depende do GitHub ao vivo: a PR desta issue esperar a revisão do Copilot na cabeça e ter zero threads abertas no merge. Ele só pode ser conferido depois do merge. A evidência fica na própria #13, num comentário logo depois do merge, com a revisão do Copilot na cabeça e as threads lidas do GitHub no merge. A PR da #4 marcou a caixa neste arquivo, citando esse comentário, porque o intent só muda por PR.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #13 (#13)
- **Status**: Completed
- **Atualizado**: 2026-09-25 (Fase: Learn), a PR #15 foi mergeada com a revisão do Copilot na cabeça e zero threads abertas, e o último critério foi marcado com a evidência da #13 (#4)
- **Atualizado**: 2026-09-28 (Fase: Build), o sinal de revisão e o `workflow_run` do refresh saíram, e o veredito fresco passou a ser só o gate em modo CI (#30)
