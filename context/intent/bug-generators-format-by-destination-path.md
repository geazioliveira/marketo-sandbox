# Bug: Os geradores formatam fora do caminho de destino e gravam antes de formatar

## Descrição

- **Esperado.** Gerar, o `--check` e o `format:check` dão o mesmo texto para cada arquivo gerado, com qualquer config do Prettier, e uma falha do Prettier no modo de gerar não muda nenhum arquivo de `src/`.
- **Atual.** Medido em 2026-09-29 sobre `d50fd00`, com Python 3.9.6, Node 24.14.0 e Prettier 3.9.6:
  - com um `overrides` para `src/**/*.ts` no `.prettierrc`, um `src/.prettierrc` ou um `src/.editorconfig`, gerar sai com 0, o `--check` logo depois sai com 1 ("3 missing or changed") e o `prettier --check` dos mesmos arquivos sai com 0;
  - com um `.prettierrc` inválido e `--target identity`, os três geradores saem com 2, e o `definitions` e o `resources` deixam 3 arquivos cada regravados sem formatação.
- **Reprodução.** Os passos da seção Como reproduzir do plano vigente da #29, ou os testes novos do `test/scripts/codegen.spec.ts`.

## Causa raiz

- **O `--check` formata noutro caminho.** O `check_output()` grava a cópia em `.codegen-tmp/src/…` (`d50fd00:scripts/marketo_codegen.py:23`, `:379-408`), e o Prettier resolve a config pelo caminho do arquivo. O modo de gerar e o `format:check` formatam em `src/`.
- **O modo de gerar grava antes de formatar.** O `write_output()` apaga a pasta, grava o texto cru e só então formata (`d50fd00:scripts/marketo_codegen.py:365-376`).
- **Cada alvo grava antes do próximo formatar.** O `main()` de cada gerador chama o `write_output()` alvo por alvo, então uma falha num alvo encontra os anteriores já regravados.

## Abordagem da correção

Resposta do dono à pergunta 1 do plano: a API do Prettier.

- **Um helper Node, `scripts/format-generated.mjs`,** formata em memória cada arquivo com a config do caminho de destino (`resolveConfig` com `editorconfig: true` e `format` com o `filepath`), com o `requirePragma` e o range forçados. Ele importa o Prettier de `<raiz>/node_modules/prettier/index.mjs` pelo caminho, porque a resolução do Node sobe até um `node_modules` de fora da raiz.
- **Os geradores formatam tudo antes de tocar em qualquer pasta.** Um `Output` por pasta de saída, e os `write_outputs()` e `check_outputs()` recebem todas as saídas da execução.
- **Sai o caminho do CLI**: o `format_with_prettier()`, a conferência do relatório por arquivo, o `.codegen-tmp` e a linha dele no `.gitignore`.
- **Uma ADR nova substitui a [0011](../decisions/0011-generators-format-without-ignore-files.md)** e mantém o que ela tinha de válido.

## Critérios de aceite

- [ ] Com cada uma das três configs que dependem do caminho, gerar sai com 0, o `--check` logo depois sai com 0, e o `prettier --check` da pasta gerada também. O `codegen.spec.ts` prova, e antes o `--check` saía com 1.
- [ ] Uma falha do Prettier no modo de gerar não muda nenhum arquivo de `src/`, em nenhum alvo da execução. O `codegen.spec.ts` prova com um `.prettierrc` inválido na raiz e só dentro de uma área, com as sentinelas intactas.
- [ ] Os geradores usam só o Prettier do `node_modules` da própria raiz. Uma árvore sem ele sai com 2, mesmo dentro de uma pasta que tem um.
- [ ] O `generate:all` reescreve `src/` byte a byte, o `check:all` imprime as 16 linhas "are current", e `npm run check`, o e2e e o gate passam.
- [ ] A ADR nova registra a decisão e substitui a 0011, e os patterns, o anti-pattern e as ADRs que citam o CLI, o `.codegen-tmp` ou os dois limites dizem o mecanismo novo.

## Decisões relacionadas

- [0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](../decisions/0011-generators-format-without-ignore-files.md), que registra os dois limites

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #29 (#29)
- **Status**: In Progress
