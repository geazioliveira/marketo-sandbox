# Bug: Specs que esperam um processo filho com um timeout de caso menor ou igual ao dele

## Descrição

- **Esperado.** Todo teste que espera um processo filho tem um timeout de caso maior que o do processo. Assim, com a máquina carregada, um processo lento é morto pelo próprio timeout e falha o caso com a saída dele, em vez de o vitest cortar o caso no meio. E um spec novo não consegue esquecer essa regra sem que um teste acuse.
- **Atual.** Em `e5b013c`:
  - `test/scripts/refresh-issue-link.spec.ts` dá 60 s ao caso (`:144`) e os mesmos 60 s ao processo filho (`:116`);
  - `test/scripts/loop-sections.spec.ts:1994` roda um `spawnSync('sh', …)` sem `timeout`, num arquivo sem `testTimeout`, ou seja, com os 5 s do padrão do vitest;
  - a regra só existe em comentários de cada arquivo (`test/support/hooks.ts:55-67`, `test/scripts/check-context.spec.ts:25-27`). O caso do relato, em `check-context.spec.ts`, ficou nos 5 s até a #34 (`3a6ac45`).
- **Reprodução.** O teste que falha antes é `test/test-timeouts.spec.ts`, que recusa os dois specs acima. A carga se reproduz com duas `npx vitest run` ao mesmo tempo, depois de um `npm ci` na worktree.

## Causa raiz

O `vitest.config.ts` não define `testTimeout` (`vitest.config.ts:7-14`). Cada spec que dispara processos precisa lembrar de declarar o seu com `vi.setConfig`, maior que o timeout do processo filho que espera, e nada confere isso.

A medição do plano mostrou que, sob carga, quase todas as falhas vêm de outra causa: os prazos de produção dos hooks (`.claude/hooks/lib/budget.mjs`, o `git` de 10 s) e casos que passam dos 120 s inteiros. Pela resposta do dono à pergunta 1 do plano, essa parte vai para uma issue própria.

## Abordagem da correção

A branch `fix/23-test-timeout-child-process` nasce de `origin/main` em `e5b013c` e segue o plano vigente da #23, com as recomendações aceitas no Approve:

1. **O guarda, vermelho.** `test/test-timeouts.spec.ts` lê cada `*.spec.ts` de `test/` e `src/`. Um spec que dispara processos, ou seja, que importa `node:child_process` ou, de `test/support/`, um dos helpers `exec`, `spawnWith`, `runHook`, `hookRepo` ou `realGit`, precisa declarar `vi.setConfig({ testTimeout })` com valor maior que todo timeout de processo do arquivo e dos helpers que ele usa.
2. **A correção.** `refresh-issue-link.spec.ts` passa a `testTimeout: 120_000`. `loop-sections.spec.ts` ganha `timeout: 30_000` no `spawnSync` e `testTimeout: 60_000`.
3. **A medição**, nos Resultados.
4. **Learn**, com o pattern [Timeouts de testes que disparam processos](../knowledge/patterns/process-test-timeouts.md) e a issue nova dos prazos dos hooks sob carga.

## Critérios de aceite

- [x] `test/test-timeouts.spec.ts` falha em `e5b013c` nos dois specs acima e passa depois da correção.
- [x] Nenhum teste que espera um processo filho tem timeout menor ou igual ao do processo.
- [x] Em cinco rodadas com duas `npx vitest run` ao mesmo tempo, nenhuma falha vem de um caso cujo timeout é menor ou igual ao do processo filho que ele espera. As falhas por prazo de hook e por caso acima de 120 s ficam registradas aqui e vão para uma issue nova.
- [ ] A PR fecha só a #23, com revisão do Copilot na cabeça, nenhuma thread aberta e veredito fresco do gate.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), a cadeia do `npm run check`

## Resultados

- **O que foi construído**, na branch `fix/23-test-timeout-child-process`:
  - `3fdfae8`: este intent;
  - `f9d4333`: `test/test-timeouts.spec.ts`, vermelho em `refresh-issue-link.spec.ts` (caso e processo com 60 s) e em `loop-sections.spec.ts` (sem `testTimeout`). O guarda classifica cada export de `test/support/` pelo próprio corpo, e não pelo módulo inteiro. Senão o `check-context.spec.ts`, que só usa o `exec`, herdaria os 60 s do gate do `TempRepo`, que ele não roda;
  - `37864d8`: `refresh-issue-link.spec.ts` com `testTimeout: 120_000`, e `loop-sections.spec.ts` com `timeout: 30_000` no `spawnSync` e `testTimeout: 60_000`. O guarda fica verde;
  - `66e7a01`: o Learn, com este intent, o pattern [Timeouts de testes que disparam processos](../knowledge/patterns/process-test-timeouts.md), citado no `CODING_STANDARDS.md`, e o changelog;
  - `09974a8` e `64ff029`, da revisão do Copilot na PR #61. O guarda passou a ler os imports por alias, a somar os repetidos e a deixar de fora os de tipo. Ele passou também a achar cada chamada de processo, fora de strings e comentários, e a exigir que ela dê o próprio timeout, nos specs e em `test/support/`. Um helper que repassa as opções, como o `exec`, deixa o timeout para quem o chama. As 15 chamadas sem timeout dos specs e as 4 dos helpers (`realGit`, `HookRepo.git`, o `rev-parse` do `HookRepo` e `TempRepo.git`) ganharam um: `spawnTimeout` nos helpers e specs dos hooks, 60 s nos specs de 120 s e em `temp-repo.ts`, e 30 s no `check-context.spec.ts` e no `python3` do `codegen.spec.ts`;
  - `53d81fe`, da segunda revisão do Copilot. A leitura por regex deixava passar uma chamada dentro do `${…}` de um template literal, um `vi.setConfig` comentado, um import de namespace de `test/support/` e um timeout de helper que não resolve. Ela também inferia o repasse do timeout só pelo tipo do parâmetro. O guarda passou a ler o código com o parser do TypeScript, que o projeto já tem para o `tsc`. O repasse só vale quando as opções da chamada vêm de um parâmetro de uma função em volta dela, com `timeout` no tipo, e um timeout que não resolve para um número positivo é recusado, num spec e num helper. Quatro mutações no repositório ficaram vermelhas com `arquivo:linha`: tirar um timeout de um spec, tirar um de um helper, fazer o `exec` parar de repassar as opções e comentar um `vi.setConfig`;
  - `dc1d951`, da terceira revisão do Copilot:
    - a resolução passou a cobrir o módulo carregado na própria chamada (`require('node:child_process').spawnSync(…)`), o nome pela ligação (um `processTimeout` local é o local), os spreads na ordem em que o objeto é montado e os namespaces entre helpers;
    - só vale o `vi.setConfig` do topo do arquivo;
    - para fechar a classe desses achados, e não só os casos, uma função de processo usada fora de uma chamada direta passou a ser recusada;
    - a primeira rodada no repositório acusou 3 falsos positivos: a entrada de um hook no `runHook(name, input, options)` lida como opções. O guarda passou a ler as opções de um helper só na posição do parâmetro com `timeout` no tipo, e as mesmas quatro mutações seguem vermelhas;
  - `104446b` e `be26d7e`, da quarta revisão do Copilot:
    - o `rev-parse` do worktree do `HookRepo`, que ganhou timeout nesta PR, passou a conferir o status e a falhar com o stderr;
    - o ponto fixo do guarda deixou de duplicar timeouts entre helpers que se chamam, e termina;
    - um timeout dado a um helper que tem o próprio (`spawnWith(…, { timeout: 180_000 })`) entra na conta;
    - vale o último `vi.setConfig`;
    - os módulos JavaScript de `test/support/` passaram a ser lidos;
    - a suíte inteira passou com 3.792 de 3.792, com load average perto de 12;
  - `6ef5ccb`, do achado que a quinta revisão do Copilot só deu no resumo: o guarda resolvia os nomes pela grafia no arquivo inteiro, e um `const spawnTimeout = 1_000` numa função vizinha mudava o `spawnTimeout` importado. Os nomes passaram a ser resolvidos pelo binder do TypeScript (um `Program` em memória, sem lib e sem resolver módulos), no escopo léxico de cada uso. Uma quinta mutação, o `testTimeout` do `gate.spec.ts` baixado para 60 s, também fica vermelha.
- **O guarda foi conferido por mutação e pela contagem.** As 19 chamadas sem timeout que ele acusou em `09974a8` são as mesmas que um script à parte contou. Ele reconhece como disparadores 15 specs: os de `test/hooks/`, menos `budget`, `settings` e `shell`, que carregam as libs no mesmo processo, e os de `test/scripts/`, menos `drift` e `forms-parity`. Com o `testTimeout` do `check-context.spec.ts` baixado para 30 s, ele recusa o arquivo citando `:183` e `:216`.
- **A causa raiz se confirmou, e era a menor parte do problema.** O descompasso existia, mas a medição mostrou que a carga derruba a suíte por outras causas.
- **Medido** em `37864d8`, numa worktree destacada com `npm ci` feito: uma rodada sozinha e cinco rodadas de duas `npx vitest run` ao mesmo tempo, com load average entre 16 e 26 no início de cada uma:

  | Rodada | Falhas em 3.754 (A / B) | Duração (A / B) |
  | --- | --- | --- |
  | Sozinha | 8 | 678 s |
  | 1 | 158 / 162 | 1.279 s / 1.280 s |
  | 2 | 32 / 33 | 741 s / 742 s |
  | 3 | 22 / 16 | 673 s / 673 s |
  | 4 | 31 / 22 | 907 s / 921 s |
  | 5 | 81 / 60 | 1.192 s / 1.196 s |

  Das 625 falhas, nenhuma caiu em `refresh-issue-link.spec.ts`, `loop-sections.spec.ts` ou `check-context.spec.ts`, e nenhuma vem de um caso com timeout menor ou igual ao do processo que ele espera. Pela causa:
  - 488 são respostas de hook que mudam sob carga. Delas, 248 citam na mensagem o `git` ou o `gh` lento, ou o prazo do hook, e as outras 240 são asserções sobre uma resposta diferente, compatíveis com a mesma causa;
  - 110 são casos que passam dos 120 s inteiros, com processos de timeout abaixo disso: ou o caso soma muitos processos, ou esperava um `git` de helper sem timeout, que a revisão do Copilot corrigiu;
  - 27 são processos mortos pelo próprio timeout antes do caso, como a correção quer: o gate e o `audit-main` com 60 s, o `plan-to-issue` com 90 s e um gerador do `codegen` com 30 s.

  As 598 primeiras foram para a #59, com a tabela por arquivo.
- **Desvios do plano aprovado:**
  - o critério 2 ficou mais estrito que o plano. A revisão do Copilot mostrou que um processo sem timeout escapava do guarda e que o timeout do caso não o encerra. O guarda passou a exigir o timeout de cada chamada, nos specs e em `test/support/`, e as 19 chamadas sem timeout ganharam um. O item dos processos de helper sem timeout saiu da #59;
  - o plano dizia que o guarda leria os specs por regex, e ele passou a usar o parser do TypeScript, porque a segunda revisão mostrou quatro formas válidas de código que o regex não lia;
  - o `TempRepo` e o `HookRepo` entraram na lista de helpers que disparam processos, junto com os cinco do plano, porque o `gate.spec.ts` e os specs dos hooks os usam. O guarda descobre essa lista pelo corpo de cada export, sem uma lista fixa;
  - a primeira medição do plano, sem `npm ci` na worktree, trouxe 46 falhas falsas do `codegen.spec.ts` por falta do Prettier.
- **Fica para depois:** a #59, com os prazos dos hooks sob carga e os casos acima de 120 s.

  O último critério, a revisão do Copilot na cabeça, as threads e o veredito fresco, é conferido no fluxo da PR, depois deste Learn.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano vigente na issue #23 (#23)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Build), das cinco revisões do Copilot na PR #61: o guarda confere o timeout de cada chamada de processo, lendo o código com o parser do TypeScript, e as 19 chamadas sem timeout ganharam um (#23)
