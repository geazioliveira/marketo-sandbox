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

- [x] Com cada uma das três configs que dependem do caminho, gerar sai com 0, o `--check` logo depois sai com 0, e o `prettier --check` da pasta gerada também. O `codegen.spec.ts` prova, e antes o `--check` saía com 1.
- [x] Uma falha do Prettier no modo de gerar não muda nenhum arquivo de `src/`, em nenhum alvo da execução. O `codegen.spec.ts` prova com um `.prettierrc` inválido na raiz e só dentro de uma área, com as sentinelas intactas.
- [x] Os geradores usam só o Prettier do `node_modules` da própria raiz. Uma árvore sem ele sai com 2, mesmo dentro de uma pasta que tem um.
- [x] O `generate:all` reescreve `src/` byte a byte, o `check:all` imprime as 16 linhas "are current", e `npm run check`, o e2e e o gate passam.
- [x] A ADR nova registra a decisão e substitui a 0011, e os patterns, o anti-pattern e as ADRs que citam o CLI, o `.codegen-tmp` ou os dois limites dizem o mecanismo novo.

## Decisões relacionadas

- [0011: Os geradores formatam sem arquivo de ignore e falham quando não formatam](../decisions/0011-generators-format-without-ignore-files.md), que registra os dois limites
- [0015: Os geradores formatam em memória, com a config do caminho de destino, antes de tocar na saída](../decisions/0015-generators-format-in-memory-at-the-destination-path.md), que a substitui

## Resultados

- **A causa raiz se confirmou.** Com o formatador em memória, o mesmo texto sai do modo de gerar, do `--check` e do `format:check`: com as três configs, os três saem com 0, e antes o `--check` saía com 1.
- **O formatador**, `scripts/format-generated.mjs`, formata pela API do Prettier com a config do caminho de destino e importa o Prettier da própria raiz pelo caminho. Os geradores formatam a saída de todos os alvos da execução numa chamada só e só depois recusam, apagam, gravam ou comparam (`scripts/marketo_codegen.py:309-431`). Saíram o CLI, a conferência do relatório por arquivo, o `.codegen-tmp` e a linha dele no `.gitignore`.
- **As falhas não tocam `src/`.** Com um `.prettierrc` inválido, na raiz ou só em `src/user-management/`, os três geradores saem com 2 e nenhum arquivo muda. Antes, o `definitions` e o `resources` deixavam 3 arquivos cada regravados sem formatação.
- **Mais rápido.** O `generate:all` caiu de 10,4 s para 4,1 s, e o `check:all` de 9,9 s para 3,8 s, com `src/` reescrito byte a byte.
- **Os testes.** O `codegen.spec.ts` ganhou 17 casos da #29, 14 deles vermelhos antes da correção: as três configs em cada gerador, a falha em cada gerador, a falha só numa área, a área avulsa e o `node_modules` de uma pasta acima. Os 6 do Prettier embrulhado saíram, os 3 de "not executable" viraram "cannot load", e os 2 de "undo the rewrite" viraram "creates nothing" e "leaves src/ untouched". O spec foi de 71 para 80 casos.
- **Onde se afastou do plano.**
  - Os geradores importam `Output` e um despachante, `write_or_check_outputs()`, no lugar dos dois nomes de antes. O `FORMATTER` ficou na linha do `TEMP`. Assim nenhuma das citações `arquivo:linha` dos geradores e do módulo comum, até o `prettier_environment()`, se deslocou (`502aab5`).
  - A ADR nova é a 0015, porque a PR #62 (#24) já tem a 0013 e a 0014.
  - A #25 (PR #60) e a #23 (PR #61) entraram antes do corte, sem mudar o escopo.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #29 (#29)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Learn), o formatador em memória, as saídas em lote, a ADR 0015 e os testes chegaram à branch, com gerar, o `--check` e o `format:check` concordando (#29)
