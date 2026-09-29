# Pattern: Timeouts de testes que disparam processos

## Resumo

Todo processo que um teste dispara tem o próprio timeout, o caso que o espera tem um timeout maior, declarado no spec com `vi.setConfig({ testTimeout })`, e o `test/test-timeouts.spec.ts` confere as duas coisas em todo spec e em `test/support/`.

## Problema

- O `vitest.config.ts` não define `testTimeout`, então um caso tem os 5 s do padrão do vitest. Os specs do harness disparam o `git`, o gate, os hooks e o `sh`, e com a máquina carregada esses processos passam de 5 s.
- Quando o caso estoura antes do processo, o vitest corta o caso e a falha sai sem a saída do processo, que é o que diria por que ele demorou.
- O timeout do caso não mata o processo. Um processo assíncrono sem timeout continua vivo depois de o caso falhar, e um `spawnSync` sem timeout bloqueia o event loop, então o timer do vitest nem dispara e o caso trava.
- A regra existia só em comentários de cada spec. O `test/scripts/check-context.spec.ts` ficou nos 5 s até a #34, enquanto esperava um processo de 30 s. Na #23, o `test/scripts/refresh-issue-link.spec.ts` dava ao caso os mesmos 60 s do processo, o `test/scripts/loop-sections.spec.ts` rodava um `sh` sem timeout num caso de 5 s, e a revisão do Copilot na PR #61 achou mais 15 chamadas sem timeout nos specs e 4 nos helpers de `test/support/`.

## Solução

- **Todo processo tem timeout, e o caso espera mais.** O processo filho recebe um `timeout:`, e quem o espera confere o `status` antes de usar a saída: um processo morto pelo timeout sai com `status` `null` e a saída vazia, e a falha precisa apontar para ele. O spec declara, logo depois dos imports, um `vi.setConfig({ testTimeout })` maior que o timeout de todo processo que os casos dele esperam, inclusive o dos helpers de `test/support/`. Um comentário ao lado diz qual processo ele cobre.
- **Os valores com nome ficam em `test/support/hooks.ts`:** `processTimeout` para o caso, `spawnTimeout` para um processo, abaixo dele, e `setupTimeout` para `beforeAll` e `beforeEach`, passado como o número depois da função do hook. Um hook que dispara processo sem ele fica nos 10 s do vitest.
- **Um helper que repassa as opções deixa o timeout para quem o chama.** O `exec` de `test/support/temp-repo.ts` espalha no processo as `options` que recebe, com um tipo que tem `timeout`: cada chamada dele, num spec ou noutro helper, dá o timeout. Um parâmetro com `timeout` no tipo que não chega ao processo não conta como repasse. O `spawnWith` e o `runHook` têm o `spawnTimeout` como padrão, e uma chamada deles pode omiti-lo. Um timeout dado a eles, mais longo que o padrão, entra na conta de quem os usa.
- **O guarda confere.** O `test/test-timeouts.spec.ts` lê cada `*.spec.ts` de `test/` e `src/` e cada módulo de `test/support/`, TypeScript ou JavaScript, com o parser e o binder do TypeScript. Assim, comentários, strings e o `${…}` de um template literal contam como contam na execução, e cada nome resolve para o que ele liga no escopo em que é usado:
  - lê os imports por alias (`exec as run`), por namespace (`import * as repo`), com `import()` e com `require()`, soma os imports repetidos do mesmo módulo e deixa de fora os de tipo (`import type`, `type HookRepo`);
  - acha cada chamada de uma função de `node:child_process` e de um helper que repassa o timeout, inclusive por um módulo carregado na própria chamada (`require('node:child_process').spawnSync(…)`) e, entre helpers, por namespace;
  - recusa uma função que dispara processo usada fora de uma chamada direta, como alias, `.call`, callback ou namespace passado adiante, porque dali o guarda não segue o processo nem o timeout dado a ele. Vale para as de `child_process` e para as de `test/support/`, inclusive as que têm timeout padrão;
  - analisa as funções privadas de um módulo de `test/support/` e as chamadas soltas no topo dele, e não só os exports, e registra cada helper por todo nome com que ele sai: `export { run as execute }`, o default (inclusive o anônimo, função ou classe) e os re-exports;
  - lê as opções de uma chamada por objeto literal, por um `const` ligado a um, ou pelos dois ramos de um ternário. De um ternário, guarda todo valor, e basta um ramo sem timeout para a chamada ficar sem timeout. Opções de helper que ele não lê são recusadas;
  - exige que cada uma dessas chamadas dê um `timeout` positivo nas opções, lidas na ordem em que o objeto é montado: um spread depois do `timeout` pode trocá-lo. O valor é um número, um nome importado de `test/support/hooks.ts` ou, num helper, o padrão de um parâmetro (num spec, quem chama a função pode dar outro, então o padrão não conta), e um nome vale o que a ligação dele vale no escopo léxico do uso: um `processTimeout` local é o local, e um `spawnTimeout` declarado noutra função não muda o importado. A exceção é a chamada cujas opções vêm de quem chama a função em volta dela. Um timeout que o guarda não lê é recusado, num spec e num helper. Num helper, as opções são só o argumento na posição do parâmetro com `timeout` no tipo, e a entrada de um hook não conta;
  - trata como disparador o spec que usa como valor, fora de um tipo, uma função de `node:child_process` ou um export de `test/support/` que dispara processos. Um import nunca usado, ou usado só num tipo (`typeof runHook`), não dispara nada;
  - exige desse spec um `vi.setConfig({ testTimeout })` do `vi` do vitest (o global ou o importado de `vitest`) como instrução do topo do arquivo;
  - compara cada processo, dele ou de um helper que ele usa, com o tempo do caso ou do hook em que roda. Esse tempo é o timeout do próprio `it`/`test` (número, ou `{ timeout }` lido na ordem, com spreads e `const`) ou do hook (o número depois da função), com o vitest importado por nome, por namespace ou global. Sem ele, vale o `testTimeout` do arquivo, ou, num hook, o `hookTimeout` do `vi.setConfig`, que no vitest é de 10 s. Uma função do arquivo passada a um caso ou hook pelo nome (`it('x', body, 5_000)`), ou chamada de dentro de um, é comparada com cada um deles. Uma fixture de `test.extend` conta no `testTimeout`, e um processo que o guarda não liga a nenhum caso ou hook também. O tempo precisa ser maior que o do processo; Um `vi.setConfig` dentro de uma função pode nunca rodar, e não conta. Com mais de um, vale o último, como no vitest, e dentro de cada um o `testTimeout` é lido na ordem em que o objeto é montado, com os spreads.

  Cada recusa cita `arquivo:linha` da chamada, ou do caso e do processo com os dois valores.
- **Os testes puros ficam nos 5 s.** Um laço infinito num teste sem processo falha rápido.

## Quando usar

- Num spec novo que dispara um processo, direto ou por um helper de `test/support/`.
- Num helper novo de `test/support/` que dispara processos: ele dá o timeout, ou o recebe de quem o chama, e esse timeout entra no que o guarda cobra de quem o importa.

## Quando NÃO usar

- Para os prazos dos hooks em si (`.claude/hooks/lib/budget.mjs` e o `git` de 10 s). Eles são valores de produção, que falham fechado de propósito. Um caso que espera mais não os muda.
- Como substituto do timeout do processo. O `testTimeout` só dá mais tempo ao caso: não encerra um processo filho, e um `spawnSync` sem timeout o impede até de disparar.
- Para o que o guarda não segue: um timeout passado a um método de uma classe de `test/support/`, como o `options` de `HookRepo.run` (o guarda conta os timeouts da classe inteira, mas não segue a instância até o método); o tipo de um parâmetro num helper JavaScript, que o guarda não lê (um repasse ali conta como processo sem timeout); um processo iniciado por outro módulo que não o `node:child_process` (como `worker_threads` ou uma biblioteca), um re-export de `child_process` por um helper, e o timeout dado a um `describe`, que vale para os casos dentro dele: o guarda compara esses casos com o `testTimeout`. Um namespace re-exportado por um helper (`export * as base from './base'`) é recusado, e não seguido.
- Para um processo que o próprio código em teste dispara, como o `git` de um hook rodado em processo pelo `repo.spec.ts`. O guarda lê as chamadas dos testes e dos helpers, não as de `.claude/hooks/` nem as de `scripts/`.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md), a cadeia do `npm run check` que roda o guarda

## Status

- **Criado**: 2026-09-28 (Fase: Learn), da correção da #23 (#23)
- **Status**: Active
- **Atualizado**: 2026-09-29 (Fase: Build), da revisão do Copilot na PR #61: o guarda confere o timeout de cada chamada de processo, nos specs e em `test/support/`, e o timeout do caso deixou de ser tratado como o que encerra um processo sem timeout; na segunda revisão, o guarda passou a ler o código com o parser do TypeScript e a conferir o repasse do timeout por chamada; na terceira, a resolver os nomes pela ligação, os spreads na ordem e os módulos carregados na chamada, e a recusar uma função de processo fora de uma chamada direta; na quarta, a contar o timeout dado a um helper que tem o próprio, a tomar o último `vi.setConfig` e a ler os helpers JavaScript; na quinta, a resolver os nomes pelo binder do TypeScript; na sexta, a analisar as funções privadas dos helpers, a recusar o alias de toda função que dispara processo, a ler os imports de specs de `src/` e a aceitar só o `vi` do vitest; na sétima, a ler o `vi.setConfig` na ordem, as opções por `const` ou ternário e os nomes de export; na oitava, a guardar o que cada ramo de um ternário dá e a ler o default export anônimo; na nona, a ler a classe exportada como default; na décima, a ler o `child_process` carregado no topo de um helper, a não ler o timeout de um parâmetro de função de spec e a ignorar o uso em tipo; na décima primeira, a comparar cada processo com o tempo do caso ou hook em que roda e a só tomar como repasse o próprio timeout de quem chama; na décima segunda, a seguir uma função do arquivo até cada caso ou hook que a nomeia ou chama; na décima terceira, a ler as opções de um caso na ordem, a reconhecer o vitest por namespace e a recusar um namespace re-exportado (#23)
