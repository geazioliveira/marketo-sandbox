# Anti-pattern: Formatar uma cópia noutro caminho que o do destino

## Resumo

Uma ferramenta que resolve a config pelo caminho do arquivo formata uma cópia, noutra pasta, com outra config. Formate o texto como se ele já estivesse no destino, e só grave depois de tudo estar formatado.

## Problema

- **O `--check` dos geradores fazia isso até a #29.** Ele gravava a cópia em `.codegen-tmp/src/…` e a formatava lá, enquanto o modo de gerar e o `format:check` formatavam em `src/`. O Prettier resolve a config pelo caminho. Com um `overrides` para `src/**/*.ts`, um `src/.prettierrc` ou um `src/.editorconfig`, gerar saía com 0 e o `--check` logo depois saía com 1 (medido sobre `d50fd00`).
- **O sintoma engana.** O que aparece é uma defasagem logo depois de regenerar, e nada aponta para a config: o arquivo gerado está certo, e é a cópia que está errada.
- **O outro lado do mesmo erro é gravar antes de formatar.** O modo de gerar apagava a pasta, gravava o texto cru e só então chamava o Prettier. Uma falha dele deixava `src/` regravado sem formatação, e cada alvo gravava antes de o próximo formatar.
- **Uma cópia do destino também não resolve.** Mover a formatação dos dois modos para a mesma pasta temporária faz gerar concordar com o `--check`, mas a saída passa a discordar do `format:check`, que lê a config do destino: o vermelho só muda de lugar.

## O que fazer em vez disso

- **Formate em memória, com o caminho de destino.** A API do Prettier aceita o texto e o `filepath`, e o `resolveConfig()` do destino dá as mesmas opções que o `format:check` usa ali. Desde a #29, é o que o `scripts/format-generated.mjs` faz ([ADR 0015](../../decisions/0015-generators-format-in-memory-at-the-destination-path.md)).
- **Termine o passo que pode falhar antes do passo que destrói.** Os geradores formatam a saída de todos os alvos da execução e só depois apagam alguma pasta. Uma falha do Prettier sai com 2 sem tocar em nada.
- **Carregue a ferramenta pelo caminho da própria raiz.** A resolução do Node sobe até qualquer `node_modules` acima do script, e num worktree sem `npm ci` isso seria a instalação de outro checkout.
- **Ponha no teste uma config que só vale no destino**, como o `test/scripts/codegen.spec.ts` faz com as três configs e com o `prettier --check` da pasta gerada.

## Exemplo do erro

```python
# A cópia fica em .codegen-tmp/src/…: um overrides para src/**, ou um .prettierrc
# dentro de src/, não chega a ela, e o check acusa defasagem logo depois de gerar.
temporary = TEMP / path.relative_to(ROOT)
temporary.write_text(header + content)
format_with_prettier([temporary])
```

## Status

- **Criado**: 2026-09-29 (Fase: Learn), da correção da #29 (#29)
- **Status**: Active
