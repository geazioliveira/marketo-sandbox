# Pattern: Revisão antes do merge

## Resumo

Nenhuma PR é mergeada sem revisão: uma revisão do Copilot na cabeça, nenhuma thread aberta, cada thread respondida antes de resolvida, um veredito fresco do gate e a revisão feita com a profundidade que o risco pede.

## Problema

- As PRs #10 e #11 foram mergeadas minutos depois de abertas, antes de a revisão do Copilot chegar. A revisão cobriu um commit que não era a cabeça, e 7 threads ficaram abertas até a #12 ([ADR 0003](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)).
- Ninguém respondeu a essas threads, porque o monitor de CI do app não vem ligado nas PRs que o agente abre (ADR 0003).
- CI verde não é revisão ([o loop, passo 8](../../../docs/development/workflow.md#o-loop)).
- Um `issue-link` verde pode estar velho: resolver uma thread não dispara nada, e um disparo do refresh sozinho não é veredito fresco ([o fluxo](../../../docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)).

## Solução

Os comandos de cada passo estão em [A revisão do Copilot e as threads](../../../docs/development/workflow.md#a-revisão-do-copilot-e-as-threads). As regras:

- **A PR abre em draft, com o monitor.** Ela abre com `gh pr create --draft`, e logo depois o agente liga nela o monitor de CI do app, com auto-fix e comentários. Em draft, os passos de revisão do gate só relatam.
- **A PR sai de draft só com o Learn commitado.** Sair de draft pede a revisão do Copilot, e todo push depois dela pede outra. Depois de cada push, se a timeline da PR não mostra um `review_requested` do Copilot depois da hora do push e nenhuma revisão dele chega na cabeça nova em uns 10 min, o agente pede de novo com `gh pr edit <n> --add-reviewer @copilot`. Uma revisão que falhou também pede de novo.
- **Uma revisão do Copilot na cabeça.** O passo `copilot-review` exige, fora de draft, uma revisão do Copilot (`Bot` com `databaseId` 175728472), `COMMENTED` ou `APPROVED`, que não falhou, no commit que é a cabeça da PR, e nenhuma outra dele a caminho ([o gate do loop](loop-gate.md#a-revisão-do-copilot-e-as-threads)).
- **Nenhuma thread aberta.** O passo `review-threads` exige zero threads não resolvidas, de qualquer autor, inclusive as desatualizadas.
- **Responder antes de resolver.** Cada thread recebe uma resposta e só então é resolvida. A resposta traz uma de três coisas, e numa thread do Copilot o motivo da resolução corresponde a ela:
  - o SHA do commit que corrige o achado (`ADDRESSED`);
  - uma issue `#N` que fica com ele (`WONT_FIX`);
  - a evidência de que ele não procede (`INVALID`).

  Um achado que só aparece no resumo da revisão ganha a mesma resposta num comentário da PR, porque o gate não o lê.
- **Veredito fresco logo antes do merge.** Depois de resolver as threads, `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>` atualiza o check, mas sozinho não é veredito fresco. O veredito fresco é `node scripts/gate.mjs --pr <n> --branch <branch>` na cabeça da PR, com saída 0, ou o `issue-link` re-rodado com `gh run rerun <run-id>` e acompanhado com `gh run watch <run-id> --exit-status`.
- **A profundidade vem do risco.** A revisão do Copilot e o gate são o mínimo de toda PR. HIGH ou NORMAL decide o que mais a revisão lê ([revisão classificada por risco](risk-classified-review.md)).
- **O gate não julga o mérito.**
  - Ele confere a forma do loop ([o gate do loop](loop-gate.md)). O mérito do plano é a leitura do dono no Approve; o da mudança é a revisão, com a profundidade que o risco pede.
  - Uma thread do dono bloqueia o merge como qualquer outra.
  - O agente só mergeia pela autorização permanente da #2: checks exigidos verdes, veredito fresco com saída 0 e a revisão feita. O dono a revoga com um comentário ([Pull requests e merge](../../../docs/development/workflow.md#pull-requests-e-merge)).
- **Não há bypass.** Com o Copilot fora do ar, a PR espera. Um merge sem a revisão na cabeça ou com thread aberta vira uma issue da [auditoria de main](../../../docs/development/workflow.md#auditoria-de-main).

## Quando usar

- Em toda PR, inclusive uma de documentação.

## Quando NÃO usar

- Como bloqueio numa PR em draft: ela ainda não pode ser mergeada, e os passos `copilot-review` e `review-threads` só relatam.
- Para julgar se a mudança está certa. Os dois passos provam que a revisão aconteceu e foi tratada, não que cada achado foi bem tratado. Isso é a revisão em si, com a profundidade que o risco pede ([revisão classificada por risco](risk-classified-review.md)).
- Na issue de acompanhamento (#1), que não tem PR.

## Decisões relacionadas

- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)
- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)
- [0001: Context Mesh no repositório e loop issue-first](../../decisions/0001-context-mesh-in-the-repository.md)

## Status

- **Criado**: 2026-09-25 (Fase: Build), do que o loop das #2, #3 e #13 já pratica, registrado na #4 (#4)
- **Status**: Active
