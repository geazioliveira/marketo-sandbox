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

- [ ] Com a opção do `issue-link.yml`, `copilot-review` e `review-threads` só relatam. Sem revisão na cabeça, com pedido pendente ou com thread aberta, o gate sai com 0 e deixa o aviso (annotation e resumo do job).
- [ ] Sem a opção, que é o veredito fresco, os dois passos bloqueiam como hoje, e um teste prova isso.
- [ ] O `issue-link.yml` de `main` passa a opção, um teste fixa isso, e nenhuma outra checagem do `issue-link` muda.
- [ ] O hook de `gh pr merge` da #5 e a auditoria de `main` continuam exigindo a revisão na cabeça, nenhum pedido pendente e nenhuma thread aberta, com teste.
- [ ] Depois do merge, a primeira PR que sai de draft fica verde no `issue-link` sem rerun manual, antes e depois da revisão do Copilot, com os ids das runs nos Resultados.
- [ ] A ADR 0003, a ADR 0002, `workflow.md`, `AGENTS.md` e os patterns do gate e da revisão dizem a regra nova. Nenhum deles diz mais que o refresh não foi provado ao vivo, nem que toda revisão do Copilot dispara o sinal.
- [ ] O `review-signal.yml` e o modo `workflow_run` do refresh saem, com a ADR 0002 e o fluxo atualizados.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Revisão antes do merge](../knowledge/patterns/review-before-merge.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano aprovado na issue #30 (#30)
- **Status**: In Progress
