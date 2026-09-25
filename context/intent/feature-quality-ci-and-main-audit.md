# Feature: CI de qualidade e auditoria de main

## Declaração de intenção

Com a #2 em `main`, toda PR passa pelo check `Vínculo com issue / issue-link`. Ainda faltam três coisas para o loop ficar completo:

- **Um check de qualidade que falhe quando o código regride.** O `Qualidade / check` da #2 roda só lint e testes. Ficam de fora o type-check dos testes, o build, o e2e e a integridade do `context/`.
- **Um rastro de toda mudança que chega em `main` fora do loop.** Isso inclui push direto, commit pelo editor web e merge de PR vermelha. No plano Free nada disso é bloqueado, então o que resta é que nada passe sem registro.
- **Um `issue-link` que não fique velho.** Retirar o Approve, mover uma label ou reabrir a issue não dispara `pull_request_target`. Hoje o check continua verde depois de qualquer uma dessas mudanças, e a regra de renovar o veredito antes do merge cobre isso só na mão.

Esta é a segunda fatia do harness acompanhado na #1.

## Critérios de aceite

- [ ] Existe o script `typecheck` (`tsc --noEmit`) e ele passa.
- [ ] `scripts/check-context.mjs` passa no `context/` atual e recusa, com um teste para cada caso:
  - [ ] link relativo quebrado;
  - [ ] título sem dois-pontos, ou sem bloco Status, exceto nos índices, no glossário e no changelog;
  - [ ] status do índice de decisões diferente do status do arquivo;
  - [ ] título de entrada do changelog fora das formas `(#issue)` e `(#issue, PR #n)`;
  - [ ] caminho absoluto de máquina (`/Users/`, `/Volumes/`, `/private/tmp/`).
- [ ] `npm run check` junta lint, typecheck, test, check:context e build.
- [ ] O `check.yml` roda `npm run check` e o e2e com `OBSERVE_ENDPOINT` apontando para loopback, e o job agregador continua se chamando `check`.
  - O e2e só entra depois de medido.
  - Se não passar num runner limpo, fica registrado como falha conhecida, com a causa, e o conserto vai para a #9 (resposta 1 do dono na #3).
- [ ] `main-audit.yml` e `scripts/audit-main.mjs` auditam só o intervalo `before..after` de cada push em `main`, pelo primeiro pai. Os commits até `fb4a804` são anteriores ao loop e nunca são auditados. Cada um destes casos tem teste:
  - [ ] commit direto;
  - [ ] force-push;
  - [ ] PR que não fecha issue.

  Cada caso abre **automaticamente** uma issue `bug` + `needs-triage` chamada "Mudança em main fora do loop: <sha7>" (resposta 2 do dono na #3), sem duplicar, e o workflow fica vermelho.
- [ ] `issue-link-refresh.yml` reage a label, comentário, fechamento e reabertura numa issue, re-executando o `issue-link` das PRs abertas que fecham aquela issue. Se o `GITHUB_TOKEN` não conseguir disparar o rerun, a limitação fica documentada na ADR 0002, com o que se mediu.
- [ ] Na PR desta issue, o check `issue-link` roda a partir de `main` e fica verde. É a primeira prova ao vivo do harness.
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

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #3 (#3)
- **Status**: In Progress
