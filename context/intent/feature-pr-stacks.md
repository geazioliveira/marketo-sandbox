# Feature: Stack de PRs, com cada fatia numa sub-issue da issue mãe

## Declaração de intenção

Uma mudança grande pode ser entregue numa stack de PRs pequenas, uma sobre a outra, cada uma com revisão e merge próprios. A PR #26, da #5, mostrou o custo de não poder: nove rodadas de revisão do Copilot sobre cerca de 30 mil linhas, com um achado numa parte segurando o merge de todas as outras. O dono fechou a PR em 2026-09-27 e pediu a #5 de volta como stack. Hoje o loop recusa uma branch cortada de outra.

A stack entra no loop sem afrouxar o vínculo com issue:

- cada fatia é uma sub-issue da issue mãe, e cada PR fecha a sua;
- o Approve do plano da mãe, que lista as fatias numa seção `Stack`, vale para elas;
- toda revogação desse Approve vale para todas as fatias.

## Critérios de aceite

- [ ] Uma issue mãe declara uma stack com uma seção `Stack` no plano vigente: a lista ordenada das branches das fatias, de baixo para cima, cada uma nomeando uma sub-issue da mãe.
- [ ] Uma sub-issue de fatia leva a label de categoria e a label `stack-slice`, sem label de estado. O gate lê, para ela, o estado, as seções, os critérios e o Approve da mãe. Ele exige que a sub-issue seja filha da mãe, que as duas estejam abertas, e que a branch esteja na `Stack` do plano vigente da mãe. Uma branch fora da `Stack`, ou uma mãe sem Approve, é recusada.
- [ ] Editar o plano da mãe depois do Approve, ou postar nela um `# Plano` novo, revoga o Approve de todas as fatias, como já revoga o da mãe.
- [ ] A PR de uma fatia pode ter como base a branch da fatia logo abaixo na `Stack`, ou `main`. Com a base na fatia de baixo, ela fica em draft; sai de draft só quando a de baixo mergeia e a PR passa a apontar para `main`.
- [ ] O `stacked` aceita as refs das fatias de baixo da mesma `Stack`, e o merge de uma delas na fatia de cima, para trazer correções, não conta como merge estranho. Qualquer outra ref continua recusada.
- [ ] O `intent-first` bloqueia só na primeira fatia. O `learn` bloqueia só na última, com a entrada do changelog citando a mãe. Nas outras fatias, os dois só relatam.
- [ ] Um evento na issue mãe (o Approve, uma label, um plano) re-executa o `issue-link` das PRs abertas que fecham as sub-issues dela.
- [ ] Um passo novo, `pr-size`, só relata as linhas alteradas da PR contra a base, com um teto de referência de 1.500 linhas.
- [ ] O `test/scripts/gate.spec.ts` cobre a primeira fatia, uma do meio e a última, a base na fatia de baixo com e sem draft, o merge da fatia de baixo, uma branch fora da `Stack`, uma mãe sem Approve, uma sub-issue de outra mãe e um plano revisado na mãe depois do Approve.
- [ ] A ADR 0001, o ciclo de vida de issue e branch, o gate do loop, o fluxo e o glossário descrevem como montar, revisar, atualizar e mergear uma stack.

## Abordagem técnica

A branch `feature/31-pr-stacks` nasce de `origin/main`. Depois deste commit, que só toca `context/intent/`, vêm:

1. os contratos em `scripts/loop-sections.mjs`: a seção opcional `Stack`, a label `stack-slice` e a posição de uma branch na stack;
2. o gate (`scripts/gate.mjs`), com os testes em `test/scripts/gate.spec.ts`: a leitura da mãe numa fatia, o `pr-base`, o `stacked`, o `intent-first` e o `learn` pela posição da fatia, e o `pr-size`;
3. o refresh, que passa a re-executar também as PRs das sub-issues da issue do evento;
4. a label `stack-slice`, criada com `gh label create`;
5. as docs e o Learn.

## Perguntas em aberto

Nenhuma. O Approve do dono na #31 (2026-09-27, "Pode seguir com suas recomendações") ficou com as cinco recomendações do plano:

- a seção `Stack` e a label `stack-slice`;
- a PR de cima em draft até a de baixo mergear;
- o `intent-first` só na primeira fatia e o `learn` só na última;
- o teto de 1.500 linhas do `pr-size`, só relatado;
- a ordem: a #31, depois a stack da #5, depois a #30.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

## Status

- **Criado**: 2026-09-27 (Fase: Intent), do plano aprovado na issue #31 (#31)
- **Status**: In Progress
