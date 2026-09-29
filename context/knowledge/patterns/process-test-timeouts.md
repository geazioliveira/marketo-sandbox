# Pattern: Timeouts de testes que disparam processos

## Resumo

Todo processo que um teste dispara tem o próprio timeout, o caso que o espera tem um timeout maior, declarado no spec com `vi.setConfig({ testTimeout })`, e o `test/test-timeouts.spec.ts` confere as duas coisas em todo spec e em `test/support/`.

## Problema

- O `vitest.config.ts` não define `testTimeout`, então um caso tem os 5 s do padrão do vitest. Os specs do harness disparam o `git`, o gate, os hooks e o `sh`, e com a máquina carregada esses processos passam de 5 s.
- Quando o caso estoura antes do processo, o vitest corta o caso e a falha sai sem a saída do processo, que é o que diria por que ele demorou.
- O timeout do caso não mata o processo. Um processo assíncrono sem timeout continua vivo depois de o caso falhar, e um `spawnSync` sem timeout bloqueia o event loop, então o timer do vitest nem dispara e o caso trava.
- A regra existia só em comentários de cada spec. O `test/scripts/check-context.spec.ts` ficou nos 5 s até a #34, enquanto esperava um processo de 30 s. Na #23, o `test/scripts/refresh-issue-link.spec.ts` dava ao caso os mesmos 60 s do processo, o `test/scripts/loop-sections.spec.ts` rodava um `sh` sem timeout num caso de 5 s, e a revisão do Copilot na PR #61 achou mais 15 chamadas sem timeout nos specs e 4 nos helpers de `test/support/`.

## Solução

- **Todo processo tem timeout, e o caso espera mais.** O processo filho recebe um `timeout:`. O spec declara, logo depois dos imports, um `vi.setConfig({ testTimeout })` maior que o timeout de todo processo que os casos dele esperam, inclusive o dos helpers de `test/support/`. Um comentário ao lado diz qual processo ele cobre.
- **Os valores com nome ficam em `test/support/hooks.ts`:** `processTimeout` para o caso, `spawnTimeout` para um processo, abaixo dele, e `setupTimeout` para `beforeAll` e `beforeEach`.
- **Um helper que repassa as opções deixa o timeout para quem o chama.** O `exec` de `test/support/temp-repo.ts` recebe um `timeout` e o passa ao processo: cada chamada dele, num spec ou noutro helper, dá o timeout. O `spawnWith` e o `runHook` têm o `spawnTimeout` como padrão, e uma chamada deles pode omiti-lo.
- **O guarda confere.** O `test/test-timeouts.spec.ts` lê como texto cada `*.spec.ts` de `test/` e `src/` e cada módulo de `test/support/`:
  - lê os imports por alias (`exec as run`), soma os imports repetidos do mesmo módulo e deixa de fora os de tipo (`import type`, `type HookRepo`);
  - acha cada chamada de uma função de `node:child_process`, importada por nome, por namespace ou com `import()`, e de um helper que repassa o timeout, fora de strings e comentários;
  - exige que cada uma dessas chamadas dê `timeout` nos próprios argumentos. Num spec, o valor precisa ser um número ou um nome de `test/support/hooks.ts`, para o guarda comparar;
  - trata como disparador o spec que importa `node:child_process` ou um export de `test/support/` que dispara processos, direto ou por outro export;
  - exige desse spec um `vi.setConfig({ testTimeout })` maior que o timeout de cada chamada dele e de cada helper que ele usa.

  Cada recusa cita `arquivo:linha` da chamada, ou do caso e do processo com os dois valores.
- **Os testes puros ficam nos 5 s.** Um laço infinito num teste sem processo falha rápido.

## Quando usar

- Num spec novo que dispara um processo, direto ou por um helper de `test/support/`.
- Num helper novo de `test/support/` que dispara processos: ele dá o timeout, ou o recebe de quem o chama, e esse timeout entra no que o guarda cobra de quem o importa.

## Quando NÃO usar

- Para os prazos dos hooks em si (`.claude/hooks/lib/budget.mjs` e o `git` de 10 s). Eles são valores de produção, que falham fechado de propósito. Um caso que espera mais não os muda.
- Como substituto do timeout do processo. O `testTimeout` só dá mais tempo ao caso: não encerra um processo filho, e um `spawnSync` sem timeout o impede até de disparar.
- Para um processo que o próprio código em teste dispara, como o `git` de um hook rodado em processo pelo `repo.spec.ts`. O guarda lê as chamadas dos testes e dos helpers, não as de `.claude/hooks/` nem as de `scripts/`.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md), a cadeia do `npm run check` que roda o guarda

## Status

- **Criado**: 2026-09-28 (Fase: Learn), da correção da #23 (#23)
- **Status**: Active
- **Atualizado**: 2026-09-29 (Fase: Build), da revisão do Copilot na PR #61: o guarda confere o timeout de cada chamada de processo, nos specs e em `test/support/`, e o timeout do caso deixou de ser tratado como o que encerra um processo sem timeout (#23)
