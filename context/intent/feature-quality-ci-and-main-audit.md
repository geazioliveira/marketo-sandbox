# Feature: CI de qualidade e auditoria de main

## Declaração de intenção

Com a #2 em `main`, toda PR passa pelo check `Vínculo com issue / issue-link`. Ainda faltam três coisas para o loop ficar completo:

- **Um check de qualidade que falhe quando o código regride.** O `Qualidade / check` da #2 roda só lint e testes. Ficam de fora o type-check dos testes, o build, o e2e e a integridade do `context/`.
- **Um rastro de toda mudança que chega em `main` fora do loop.** Isso inclui push direto, commit pelo editor web e merge de PR vermelha. No plano Free nada disso é bloqueado, então o que resta é que nada passe sem registro.
- **Um `issue-link` que não fique velho.** Retirar o Approve, mover uma label ou reabrir a issue não dispara `pull_request_target`. Hoje o check continua verde depois de qualquer uma dessas mudanças, e a regra de renovar o veredito antes do merge cobre isso só na mão.

Esta é a segunda fatia do harness acompanhado na #1.

## Critérios de aceite

- [x] Existe o script `typecheck` (`tsc --noEmit`) e ele passa.
- [x] `scripts/check-context.mjs` passa no `context/` atual e recusa, com um teste para cada caso:
  - [x] link relativo quebrado;
  - [x] título sem dois-pontos, ou sem bloco Status, exceto nos índices, no glossário e no changelog;
  - [x] status do índice de decisões diferente do status do arquivo;
  - [x] título de entrada do changelog fora das formas `(#issue)` e `(#issue, PR #n)`;
  - [x] caminho absoluto de máquina (`/Users/`, `/Volumes/`, `/private/tmp/`).
- [x] `npm run check` junta lint, typecheck, test, check:context e build.
- [x] O `check.yml` roda `npm run check` e o e2e com `OBSERVE_ENDPOINT` apontando para loopback, e o job agregador continua se chamando `check`.
  - O e2e só entra depois de medido.
  - Se não passar num runner limpo, fica registrado como falha conhecida, com a causa, e o conserto vai para a #9 (resposta 1 do dono na #3).
- [x] `main-audit.yml` e `scripts/audit-main.mjs` auditam a linha do primeiro pai de `main`, com um teste para cada um destes casos (o intervalo e a linha de base mudaram na revisão; ver Resultados):
  - [x] commit direto;
  - [x] force-push;
  - [x] PR que não fecha issue.

  Cada caso abre **automaticamente** uma issue `bug` + `needs-triage` chamada "Mudança em main fora do loop: <sha7>" (resposta 2 do dono na #3), sem duplicar, e o workflow fica vermelho.
- [x] `issue-link-refresh.yml` reage a label, comentário, fechamento e reabertura numa issue, re-executando o `issue-link` das PRs abertas que fecham aquela issue. Se o `GITHUB_TOKEN` não conseguir disparar o rerun, a limitação fica documentada na ADR 0002, com o que se mediu.
- [x] Na PR desta issue, o check `issue-link` roda a partir de `main` e fica verde. É a primeira prova ao vivo do harness.
- [ ] Na primeira execução, o `main-audit` audita o merge desta própria PR e não abre issue.

## Abordagem técnica

- **Um check agregado.** `npm run check` roda tudo que o CI roda, exceto o e2e. O e2e é um passo à parte do job `check`, com `OBSERVE_ENDPOINT` em loopback. Assim o nome do check exigido (`Qualidade / check`) não muda.
- **`check:context` lê do mesmo contrato.** O formato do título do changelog vem de `changelogHeading`, em `scripts/loop-sections.mjs`, e não de uma segunda cópia.
- **A auditoria roda o código de `main`,** porque um push em `main` dispara o workflow de `main`. Ela usa só `GET` e `issues: write`. A issue que ela abre é um relato: categoria + `needs-triage`, a única label de estado que o agente pode pôr na criação.
- **O refresh também roda em `main`** (eventos de issue sempre usam o workflow do branch padrão). Ele só re-executa uma run existente do `issue-link`, com `actions: write` e nenhuma outra escrita.
- **Commits em ordem:** intent, typecheck, check:context, check agregado + `check.yml`, auditoria, refresh, docs e Learn.

## Perguntas em aberto

Respondidas pelo dono na #3 (2026-09-25):

1. Se o e2e não passar num runner limpo, ele fica fora do `check` como falha conhecida, e o conserto vai para a #9. Resposta: "Sim".
2. As issues do `main-audit` são abertas automaticamente. Resposta: "Vamos abrir automaticamente".

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), cujas camadas 1 e 6 esta feature completa.

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md). Desvios do plano aprovado, todos para o lado que julga mais:

- **O intervalo da auditoria não é `before..after`.** Ele vai do topo da última run cujo passo `Julgar` terminou até o topo atual, com uma execução diária e uma manual. Com `before..after`, um push que não dispara run (um token de pular CI, um push feito com o `GITHUB_TOKEN`, uma run cancelada) nunca seria julgado. Isso ficou registrado no [anti-pattern](../knowledge/anti-patterns/audit-bound-from-the-event.md).
- **A linha de base é `8d4662f`, não `fb4a804`.** É o merge da #2, a exceção de bootstrap: o `issue-link` do servidor chegou com ele e não podia estar verde nele.
- **Estar no loop também exige os checks verdes.** Um merge só conta como dentro do loop se a PR teve `Vínculo com issue / issue-link` (de `pull_request_target`) e `Qualidade / check` verdes antes do merge. Assim um merge de PR vermelha vira issue.
- **Três casos passaram a virar issue:** uma reescrita de `main` desde a última auditoria (pelo compare do GitHub quando o topo antigo sumiu do clone), um intervalo com mais de 200 commits, e mais de 10 commits fora do loop numa auditoria (uma issue só).
- **Tokens de pular CI e o trailer `skip-checks: true` ficam proibidos** no título, no corpo e nos commits da PR.
- **Os dois últimos critérios dependem de GitHub ao vivo.** O primeiro, `issue-link` verde a partir de `main` na PR, é marcado depois do CI desta PR. O segundo, a primeira auditoria do merge sem issue, só é observável depois do merge: o resultado vai num comentário na #3, e a PR da #4 o registra aqui.

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #3 (#3)
- **Status**: In Progress
- **Atualizado**: 2026-09-25 (Fase: Learn), o `issue-link` rodou de `main` e ficou verde na PR #11; só falta observar a primeira auditoria depois do merge, que a PR da #4 registra (#3)
