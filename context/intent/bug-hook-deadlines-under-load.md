# Bug: Prazos dos hooks e casos acima de 120 s com a máquina carregada

## Descrição

- **Esperado.** Com a máquina carregada, a suíte fica mais lenta, mas um caso só falha quando o código está errado.
- **Atual.** Na medição da #23, em `37864d8`, foram uma rodada sozinha e cinco rodadas de duas `npx vitest run` ao mesmo tempo, com load average entre 16 e 26. Deram 625 falhas, sem nenhum teste errado:
  - 488 são respostas de hook que mudam quando o `git` ou o `gh` demora;
  - 110 são casos que passam dos 120 s inteiros: `gate` 53, `repo` 40, `build-guard` 13, `guard-bash` 3 e `audit-main` 1;
  - 27 são processos mortos pelo próprio timeout.
- **Reprodução.** `npm ci` numa worktree destacada de `main`, e cinco rodadas de duas `npx vitest run` ao mesmo tempo. As falhas mudam de uma rodada para outra.

## Causa raiz

Lida no código em `22059b6`; a medição de partida confirma ou corrige a divisão.

- **O `git` dos hooks tem 10 s fixos, sem ajuste.** São três constantes privadas: `.claude/hooks/lib/repo.mjs:53`, `.claude/hooks/lib/edit-gate.mjs:52` e `.claude/hooks/lib/git-rules.mjs:392`. O `gh` já tem o `LOOP_HOOKS_GH_TIMEOUT_MS` (`.claude/hooks/lib/gh-rules.mjs:137-141`). Os dois passam por `spawnTimeout()`, que dá a cada processo o menor entre o timeout dele e o que resta do orçamento do hook (`.claude/hooks/lib/budget.mjs:106-109`). O orçamento só baixa pelo ambiente (`budget.mjs:57-66`).
- **Os specs dos hooks rodam com os prazos de produção.** O ambiente padrão dos helpers não leva nenhum dos dois prazos de processo (`test/support/hooks.ts:196-225`, `:503-512`). Sob carga, um `git` passa de 10 s, e o hook responde "o hook falhou" em vez da decisão que o caso confere.
- **O `repo.spec.ts` bloqueia os próprios casos.** Ele roda a lib no mesmo processo, com `spawnSync` de `git`, dentro de grupos `describe.concurrent` com `maxConcurrency: 12` (`test/hooks/repo.spec.ts:79`, `:90`). Um `spawnSync` bloqueia o worker, e o timer dos outros casos continua correndo.
- **O `gate.spec.ts` refaz a mesma stack a cada caso.** 49 casos começam com `await stack(fresh)` (`test/scripts/gate.spec.ts:3979-4012`), cada um com uns 26 `git`. Os casos mais pesados rodam o gate 8 ou 9 vezes em sequência (`:5442`, `:5875`).

## Abordagem da correção

O plano vigente e o Approve estão na #59, e o dono seguiu todas as recomendações:
- a variável `LOOP_HOOKS_GIT_TIMEOUT_MS`;
- nenhum teto de workers por enquanto;
- a stack construída uma vez e copiada, com os casos pesados divididos;
- uma PR só.

A branch é `fix/59-prazos-dos-hooks-sob-carga`, cortada de `origin/main` em `22059b6`.

- **O `git` dos hooks.** `gitTimeoutMs(env)` em `.claude/hooks/lib/budget.mjs` lê o `LOOP_HOOKS_GIT_TIMEOUT_MS`, que sobe ou baixa os 10 s, sempre por `spawnTimeout()`. O orçamento continua só baixando.
- **Os specs dos hooks.** O ambiente padrão dos helpers leva o `git` e o `gh` de 60 s, acima de todo orçamento, e só os casos que testam um prazo dão outro valor.
- **O `repo.spec.ts`.** Os grupos que chamam a lib no mesmo processo deixam de ser concorrentes.
- **O `gate.spec.ts`.** A stack é montada uma vez por arquivo e copiada por caso. Os casos de 6 a 9 rodadas do gate viram linhas.
- **A medição.** Cinco rodadas de duas `npx vitest run` ao mesmo tempo, antes e depois, nas mesmas condições.

## Critérios de aceite

- [ ] `LOOP_HOOKS_GIT_TIMEOUT_MS` sobe e baixa o timeout de cada `git` dos hooks, e um teste prova que ele nunca passa do que resta do orçamento. O teste falha antes e passa depois.
- [ ] Os specs dos hooks rodam, por padrão, com o `git` e o `gh` de 60 s, e só os casos que testam um prazo dão outro valor. Um teste confere o ambiente padrão dos helpers.
- [ ] No `repo.spec.ts`, nenhum grupo concorrente chama a lib dos hooks no mesmo processo.
- [ ] No `gate.spec.ts`, a stack é construída uma vez por arquivo e copiada por caso, e nenhum caso roda o gate mais de 3 vezes.
- [ ] Em cinco rodadas com duas `npx vitest run` ao mesmo tempo, nenhuma falha vem do prazo de um hook ou de um caso acima de 120 s, ou cada uma que sobrar está explicada aqui. A tabela sai ao lado da do relato.
- [ ] O `test/test-timeouts.spec.ts`, o `npm run check`, o e2e e o gate passam.
- [ ] O intent, o pattern dos timeouts, o README dos hooks e o changelog registram a regra e a medição.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), que registra os hooks e o prazo de cada um

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #59 (#59)
- **Status**: In Progress
