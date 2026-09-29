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
4. **Learn**, com o pattern `process-test-timeouts.md` e a issue nova dos prazos dos hooks sob carga.

## Critérios de aceite

- [ ] `test/test-timeouts.spec.ts` falha em `e5b013c` nos dois specs acima e passa depois da correção.
- [ ] Nenhum teste que espera um processo filho tem timeout menor ou igual ao do processo.
- [ ] Em cinco rodadas com duas `npx vitest run` ao mesmo tempo, nenhuma falha vem de um caso cujo timeout é menor ou igual ao do processo filho que ele espera. As falhas por prazo de hook e por caso acima de 120 s ficam registradas aqui e vão para uma issue nova.
- [ ] A PR fecha só a #23, com revisão do Copilot na cabeça, nenhuma thread aberta e veredito fresco do gate.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), a cadeia do `npm run check`

## Resultados

- A escrever no Learn.

## Status

- **Criado**: 2026-09-28 (Fase: Intent), do plano vigente na issue #23 (#23)
- **Status**: In Progress
- **Atualizado**: 2026-09-28 (Fase: Intent), o plano aprovado com as recomendações das três perguntas (#23)
