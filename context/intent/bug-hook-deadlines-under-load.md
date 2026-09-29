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

- [x] `LOOP_HOOKS_GIT_TIMEOUT_MS` sobe e baixa o timeout de cada `git` dos hooks, e um teste prova que ele nunca passa do que resta do orçamento. O teste falha antes e passa depois.
- [x] Os specs dos hooks rodam, por padrão, com o `git` e o `gh` de 60 s, e só os casos que testam um prazo dão outro valor. Um teste confere o ambiente padrão dos helpers.
- [x] No `repo.spec.ts`, nenhum grupo concorrente chama a lib dos hooks no mesmo processo.
- [x] No `gate.spec.ts`, a stack é construída uma vez por arquivo e copiada por caso, e nenhum caso roda o gate mais de 3 vezes.
- [x] Em cinco rodadas com duas `npx vitest run` ao mesmo tempo, nenhuma falha vem do prazo de um hook ou de um caso acima de 120 s, ou cada uma que sobrar está explicada aqui. A tabela sai ao lado da do relato.
- [x] O `test/test-timeouts.spec.ts`, o `npm run check`, o e2e e o gate passam.
- [x] O intent, o pattern dos timeouts, o README dos hooks e o changelog registram a regra e a medição.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), que registra os hooks e o prazo de cada um

## Resultados

Os commits seguem os passos do plano: o intent (`6990fd6`), os testes que falham (`fb617f2`), a variável nos hooks (`1059e97`), os specs dos hooks com os prazos de processo altos (`10b0600`), o `repo.spec.ts` em sequência (`e257be1`), o `gate.spec.ts` com a stack copiada (`274635f`) e este Learn.

- **Os testes novos falharam antes da correção.** Na cabeça `fb617f2`, os 4 casos novos falharam: os 2 do `budget.spec.ts`, o do `settings.spec.ts` e o do ambiente padrão no `repo.spec.ts`. Depois dos passos 4 e 5, passam.
- **O que foi construído:**
  - `gitTimeoutMs()` e `gitTimeoutVariable` em `.claude/hooks/lib/budget.mjs`. O `repo.mjs`, o `edit-gate.mjs` e o `git-rules.mjs` passaram a ler o timeout do `git` dali, sempre por `spawnTimeout()`. Sem a variável, a produção não mudou;
  - `hookProcessTimeouts`, `hookEnv()` e `raiseInProcessGitTimeout()` em `test/support/hooks.ts`. O `HookRepo.env()` leva os dois prazos de 60 s. Os três casos que rodavam um hook com `cleanEnv(dir)` passaram a usar `hookEnv(dir)`;
  - os casos de prazo foram relidos. Só um dependia dos 10 s, o "SessionStart, git hung" do `session-context.spec.ts`, que passou a dá-los explícitos. Os outros dão o próprio orçamento, e o orçamento corta antes;
  - no `repo.spec.ts`, os grupos `repoAt`, `real paths` e `configuredRemote` saíram de `describe.concurrent`;
  - no `gate.spec.ts`, o `templated()` monta uma vez a stack padrão, a `stackWithoutIntent` e a `middleOverForeign`. O `middleOverExcluded` ficou sem template, porque é chamado uma vez só. O `TempRepo.fromTemplate()` copia o repositório com `fs.cpSync`, e o `TempRepo` passou a dar a identidade do `git` pelo ambiente, sem os 3 `git config`;
  - a fixture `fresh` soma as rodadas do gate do caso e falha acima de 3 (`maxGateRuns`). A primeira rodada achou 5 casos acima do teto, com 9, 8, 6, 4 e 4 rodadas: os 4 do plano e "fails closed when the parent is refused, missing, or unread in CI". Eles viraram linhas de `test.for` ou casos menores, com as mesmas asserções, e o arquivo foi de 365 para 386 casos;
  - o guarda da #23 (`test/test-timeouts.spec.ts`) seguiu verde em cada passo.
- **A medição**, no protocolo da #59: numa worktree destacada com `npm ci`, cinco rodadas de duas `npx vitest run` ao mesmo tempo, antes em `main` (`22059b6`) e depois na cabeça `274635f`. O load average é o de 1 minuto, no início de cada rodada:

  | Rodada | `main`: falhas A / B | Load | Depois: falhas A / B | Load |
  | --- | --- | --- | --- | --- |
  | 1 | 127 / 161 | 19,8 | 29 / 27 | 11,8 |
  | 2 | 29 / 24 | 16,7 | 8 / 8 | 18,7 |
  | 3 | 25 / 21 | 16,0 | 8 / 9 | 20,5 |
  | 4 | 27 / 27 | 17,1 | 9 / 8 | 20,4 |
  | 5 | 34 / 38 | 16,3 | 49 / 45 | 20,8 |

  Foram 513 falhas antes e 200 depois, em 3.822 e 3.847 casos por execução, com a carga mais alta nas rodadas 2 a 5 de depois. Pela causa:
  - "o hook falhou" com o `git` ou o `gh` lento: de 187 para 2;
  - o `git` de 10 s com `ETIMEDOUT` no mesmo processo: de 23 para 0. O `repo.spec.ts` foi de 42 falhas para 0, e o `git-rules.spec.ts`, de 6 para 0;
  - casos acima de 120 s: de 56 para 44. O `gate.spec.ts` foi de 25 para 10 e o `repo.spec.ts`, de 22 para 0; o `build-guard.spec.ts` subiu de 6 para 21, e o `guard-bash.spec.ts`, de 1 para 10;
  - "o prazo de N s do hook acabou": de 6 para 13;
  - o gate morto pelo próprio timeout de 60 s: 17 e 17;
  - outras respostas: de 224 para 124.
- **As falhas que sobraram, explicadas.** Agora só o orçamento limita um hook, e as falhas que restam mudaram de natureza:
  - **o orçamento de produção se esgota.** São 15 s no `session-context` e 20 s no `plan-to-issue`. A maior parte das 43 falhas do `session-context` e das 71 do `plan-to-issue` é uma resposta diferente: uma linha a menos no contexto, o marcador que fica, uma saída onde se esperava nenhuma. O orçamento só baixa pelo ambiente, de propósito, e o plano o manteve assim;
  - **os casos dos hooks acima de 120 s.** Antes o hook desistia aos 10 s de `git`, e agora gasta até o orçamento. Os casos que rodam o hook muitas vezes num laço passam do tempo, como "each variable that moves git's config" no `guard-bash.spec.ts` e "asks, critical, for every harness path" no `build-guard.spec.ts`. É o mesmo problema que o `gate.spec.ts` tinha;
  - **o gate morto pelos 60 s do `TempRepo.gate`**, sem mudança;
  - **um caso de prazo sensível à carga:** "asks when gh is slower than the timeout" mediu 16,4 s contra um limite de 15 s.

  Pela decisão do dono ao ver a medição, esses resíduos foram para a #74, com a pergunta 2 do plano (o teto de workers do vitest), em vez de estender esta PR.
- **O relatório JSON do vitest guarda um caso acima do timeout como `Error: STACK_TRACE_ERROR`.** É o erro que o vitest cria antes de rodar o caso, e o "Test timed out" não aparece. Um classificador que só procura "Test timed out" deixa esses casos passarem por outra causa.
- **Os hooks desta sessão estouraram o `git` de 10 s** várias vezes durante a medição de partida, com a carga em 22, ao conferir uma edição ou um comando. É o mesmo defeito, em produção, com a máquina carregada.
- **Numa rodada inicial dos specs dos hooks,** o caso "ends the read of the .gitignore, hung, when the budget runs out" (`build-guard.spec.ts`) falhou uma vez: o orçamento de 3 s acabou antes do passo que ele confere. Na medição depois, ele falhou em 1 das 10 execuções. É um caso de prazo sensível à carga, como o do `gh`, e foi junto para a #74.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #59 (#59)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Learn), o `git` dos hooks ganhou o `LOOP_HOOKS_GIT_TIMEOUT_MS`, os specs dos hooks rodam com os prazos de processo de 60 s, e o `gate.spec.ts` copia a stack e limita as rodadas do gate por caso; a medição caiu de 513 para 200 falhas, e os resíduos foram para a #74 (#59)
