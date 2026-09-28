# Bug: O issue-link fica vermelho em toda PR, porque nada o renova depois da revisão do Copilot

## Descrição

- **Esperado.** O check `Vínculo com issue / issue-link` de uma PR fica verde quando a PR e o loop estão em ordem, sem que ninguém precise re-rodar nada à mão. A revisão do Copilot na cabeça e as threads continuam exigidas antes do merge por quem decide o merge: o veredito fresco, o hook de `gh pr merge` e a auditoria de `main`.
- **Atual.** Em `5141466`:
  - fora de draft, o `issue-link` bloqueia em `copilot-review` enquanto a revisão pedida não chega, e ela chega de 2,5 a 22 min depois do pedido. O plano vigente na #30 mediu 32 de 76 tentativas vermelhas, todas em `copilot-review`, e 4 das 5 PRs mergeadas sob a regra da #13 só ficaram verdes com um `gh run rerun` manual;
  - quando a revisão chega, nada renova o check. A run do `Sinal de revisão` disparada pelo Copilot termina `action_required`, uma revisão sem comentários nem cria uma run, e resolver uma thread não é evento de workflow.
- **Reprodução.** Os passos 1 a 3 de "Como reproduzir" do plano vigente na #30.

## Causa raiz

- **O bloqueio é do desenho.** A ADR 0003 (item 1) faz `copilot-review` e `review-threads` bloquearem no CI fora de draft (os passos de mesmo nome em `scripts/gate.mjs`). Como a revisão chega depois do pedido, a run de cada push nasce vermelha.
- **O defeito é que nada renova o check.** O `pull_request_target` não reage a revisões. O sinal disparado pelo Copilot fica em `action_required`, porque o GitHub pede aprovação para a run de um bot, e uma revisão sem comentários nem cria uma run do sinal.
- **A ADR 0003 contradiz a prática.** Ela rejeitou "Só renovação manual" porque o check ficaria velho até alguém lembrar de renová-lo, e a ADR 0002 aceitou exatamente isso como limite.

## Abordagem da correção

A branch `fix/30-issue-link-vermelho-em-toda-pr` nasce de `origin/main` em `5141466`, depois do merge da #5, e segue o plano vigente na #30 com as respostas do Approve de 2026-09-26 23:49 UTC ("Pode seguir com suas recomendações"):

1. **Intent.** Este arquivo.
2. **Gate.** O modo CI ganha uma opção que faz `copilot-review` e `review-threads` só relatarem. Quando um dos dois bloquearia, o gate sai com 0 e deixa um aviso visível na PR: uma annotation `::warning::` e o resumo do job. Sem a opção, que é o veredito fresco, os dois bloqueiam como hoje.
3. **Workflow.** O `issue-link.yml` passa a opção. Como o `pull_request_target` roda o YAML de `main`, uma PR não consegue mudá-la. Saem o `review-signal.yml` e o modo `workflow_run` do `issue-link-refresh.yml`; o refresh continua nos eventos de issue e no `workflow_dispatch`.
4. **Hook e auditoria.** Nenhuma regra muda. Testes confirmam que o hook de `gh pr merge` e a auditoria de `main` continuam exigindo a revisão na cabeça, nenhum pedido pendente e nenhuma thread aberta, lidos ao vivo. As mensagens que mandam re-rodar o `issue-link` como veredito fresco passam a mandar rodar o gate em modo CI.
5. **Docs**, no presente: a ADR 0003, a ADR 0002, o fluxo, o `AGENTS.md`, os patterns do gate e da revisão e, se preciso, o glossário.
6. **Learn**, com um anti-pattern novo, "check que espera um evento que não chega".

As respostas do Approve:

- a correção (a), que separa o veredito;
- o `Sinal de revisão` e o modo `workflow_run` do refresh saem;
- o aviso é só a annotation e o resumo do job, sem comentário na PR;
- a branch esperou o merge da #5, que entrou pela stack de 10 PRs (#42 a #55), e não pela PR #26 que o plano citava, fechada pelo dono.

## Critérios de aceite

- [x] Com a opção do `issue-link.yml`, `copilot-review` e `review-threads` só relatam. Sem revisão na cabeça, com pedido pendente ou com thread aberta, o gate sai com 0 e deixa o aviso (annotation e resumo do job).
- [x] Sem a opção, que é o veredito fresco, os dois passos bloqueiam como hoje, e um teste prova isso.
- [x] O `issue-link.yml` de `main` passa a opção, um teste fixa isso, e nenhuma outra checagem do `issue-link` muda.
- [x] O hook de `gh pr merge` da #5 e a auditoria de `main` continuam exigindo a revisão na cabeça, nenhum pedido pendente e nenhuma thread aberta, com teste.
- [ ] Depois do merge, a primeira PR que sai de draft fica verde no `issue-link` sem rerun manual, antes e depois da revisão do Copilot, com os ids das runs nos Resultados.
- [x] A ADR 0003, a ADR 0002, `workflow.md`, `AGENTS.md` e os patterns do gate e da revisão dizem a regra nova. Nenhum deles diz mais que o refresh não foi provado ao vivo, nem que toda revisão do Copilot dispara o sinal.
- [x] O `review-signal.yml` e o modo `workflow_run` do refresh saem, com a ADR 0002 e o fluxo atualizados.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Revisão antes do merge](../knowledge/patterns/review-before-merge.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md), na branch `fix/30-issue-link-vermelho-em-toda-pr`:

- **O gate** ganhou `--review-report` (`76180e9`). Só no modo CI, fora de draft, a opção faz `copilot-review` e `review-threads` só relatarem. Cada um que bloquearia vira uma annotation `::warning::` na saída, onde o workflow a lê, e uma linha no resumo do job (`GITHUB_STEP_SUMMARY`), e o gate sai com 0 se o resto está em ordem. Fora do modo CI, a opção é recusada com saída 2.
- **O `issue-link.yml`** passa a opção (`d6a7d2e`), e testes fixam isso e que o veredito fresco das docs e do `gateCiCommand` nunca a passa.
- **O `Sinal de revisão` e o modo `workflow_run` do refresh** saíram (`32d971f`), com os contratos `reviewSignalWorkflow` e `reviewSignalWorkflowFile`, a busca de PR pela branch no `refresh-issue-link.mjs` e o suporte dela no `gh` falso dos testes. Um `GITHUB_EVENT_NAME` `workflow_run` agora é recusado pelo script.
- **O hook de `gh pr merge` e a auditoria de `main`** seguem exigindo a revisão na cabeça, nenhum pedido pendente e nenhuma thread aberta com os checks exigidos verdes, com testes que dizem isso (`09d4623`). A nota de refresh interrompido e o comentário do `gateCiCommand` passaram a dar só o gate como veredito fresco.
- **As docs** dizem a regra nova (`b87cbc4`): a ADR 0003, a ADR 0002, o fluxo, o `AGENTS.md`, o glossário e os patterns do gate, da revisão e do ciclo de vida.

Como foi verificado:

- **`npm run check`** passou com 3.743 testes em 21 arquivos, o e2e com 33, e o gate está aberto para a #30. O `gate.spec.ts` ganhou 8 casos da opção.
- **Sete mutações da opção** foram pegas, cada uma por pelo menos um caso: a opção que não relaxa, a annotation ausente, o resumo ausente, o aviso numa draft, a opção aceita fora do modo CI, o `%` sem escape e a annotation fora da saída padrão. Elas rodaram numa cópia da árvore fora do git, para não escrever no harness sem a confirmação do dono.
- **A prova ao vivo fica para depois do merge.** O `issue-link` desta PR ainda roda o gate de `main`, o de antes. A primeira PR depois do merge deve sair de draft e ficar verde no `issue-link` sem rerun, antes e depois da revisão do Copilot; os ids das runs vão para um comentário na #30 e para estes Resultados, no Learn dessa PR. Até lá, esse critério fica aberto.

Desvios do plano:

- **O nome da opção** ficou `--review-report`, como o plano propunha.
- **O `gh` falso dos testes** perdeu a consulta de PRs por branch, que só o modo `workflow_run` usava: uma consulta assim agora é recusada como inesperada.
- **O `AGENTS.md` não dá mais o comando de disparo do refresh**, porque resolver uma thread não pede mais atualizar o check. O `drift.spec` deixou de exigi-lo ali.
- **O Build passou pelos hooks da #5, ligados desde a PR #55.** As edições no gate, nos workflows e nos scripts do loop pediram a confirmação do dono uma a uma, com a sessão fora do modo automático, como o dono escolheu.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #30 (#30)
- **Status**: Resolved
- **Atualizado**: 2026-09-28 (Fase: Learn), o `issue-link` só relata a revisão do Copilot e as threads, o veredito fresco é só o gate, e o sinal de revisão saiu; a prova ao vivo fica para a primeira PR depois do merge (#30)
