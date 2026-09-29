# Pattern: Timeouts de testes que disparam processos

## Resumo

Um caso que espera um processo filho tem timeout maior que o do processo, declarado no spec com `vi.setConfig({ testTimeout })`, e o `test/test-timeouts.spec.ts` confere isso em todo spec.

## Problema

- O `vitest.config.ts` não define `testTimeout`, então um caso tem os 5 s do padrão do vitest. Os specs do harness disparam o `git`, o gate, os hooks e o `sh`, e com a máquina carregada esses processos passam de 5 s.
- Quando o caso estoura antes do processo, o vitest corta o caso e a falha sai sem a saída do processo, que é o que diria por que ele demorou.
- A regra existia só em comentários de cada spec. O `test/scripts/check-context.spec.ts` ficou nos 5 s até a #34, enquanto esperava um processo de 30 s. Na #23, o `test/scripts/refresh-issue-link.spec.ts` dava ao caso os mesmos 60 s do processo, e o `test/scripts/loop-sections.spec.ts` rodava um `sh` sem timeout num caso de 5 s.

## Solução

- **Todo processo tem timeout, e o caso espera mais.** O processo filho recebe um `timeout:`. O spec declara, logo depois dos imports, um `vi.setConfig({ testTimeout })` maior que o timeout de todo processo que os casos dele esperam, inclusive o dos helpers de `test/support/`. Um comentário ao lado diz qual processo ele cobre.
- **Os valores com nome ficam em `test/support/hooks.ts`:** `processTimeout` para o caso, `spawnTimeout` para um processo, abaixo dele, e `setupTimeout` para `beforeAll` e `beforeEach`.
- **O guarda confere.** O `test/test-timeouts.spec.ts` lê cada `*.spec.ts` de `test/` e `src/` como texto:
  - trata como disparador o spec que importa `node:child_process`, estático ou com `import()`, ou um export de `test/support/` cujo corpo dispara processos, direto ou por outro export do módulo;
  - exige `vi.setConfig({ testTimeout })`;
  - exige que esse valor seja maior que todo `timeout:` numérico ou com nome do spec e dos exports que ele usa.

  Cada recusa cita `arquivo:linha` do caso e do processo, com os dois valores.
- **Os testes puros ficam nos 5 s.** Um laço infinito num teste sem processo falha rápido.

## Quando usar

- Num spec novo que dispara um processo, direto ou por um helper de `test/support/`.
- Num helper novo de `test/support/` que dispara processos: o timeout dele entra no que o guarda cobra de quem o importa.

## Quando NÃO usar

- Para os prazos dos hooks em si (`.claude/hooks/lib/budget.mjs` e o `git` de 10 s). Eles são valores de produção, que falham fechado de propósito. Um caso que espera mais não os muda.
- Para um processo sem timeout. O guarda só compara o que está escrito. Um `exec` sem `timeout:` não entra na conta, e é o timeout do caso que o encerra.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md), a cadeia do `npm run check` que roda o guarda

## Status

- **Criado**: 2026-09-28 (Fase: Learn), da correção da #23 (#23)
- **Status**: Active
- **Atualizado**: 2026-09-28 (Fase: Learn), o guarda `test/test-timeouts.spec.ts` confere a regra em todo spec (#23)
