# Anti-pattern: Mover as pastas geradas sem o gerador

## Resumo

Mover a pasta de saída de um gerador sem mudar o gerador deixa dois layouts, o commitado e o que o gerador emite, e o `--check` não passa mais.

## Problema

- **O README anunciou o layout antes da mudança.** `01ee283` acrescentou a tabela com `src/asset/asset-definitions` e `src/asset/asset-mocks` (`01ee283:README.md:63-67`) antes de as duas pastas existirem.
- **As pastas mudaram, e os geradores não.** Nenhum destes commits toca `scripts/`:
  - `a19d9d3` apagou 101 dos 255 DTOs de `src/asset-definitions/`;
  - `e7a0bb6` recriou esses 101 em `src/asset/asset-definitions/`, renomeou os outros 154 para lá e reformatou os 255. São os mesmos 255 nomes, antes e depois;
  - `b91681a` commitou os 259 arquivos das factories (as 255 factories e os auxiliares) direto em `src/asset/asset-mocks/`, 3 minutos e meio depois de `0ef242d` trazer o gerador delas já com a saída em `src/asset-mocks`.
- **Os geradores ficaram no layout antigo até a #6** (#7):
  - `610e101:scripts/generate-marketo-definitions.py:23`: `OUTPUT = ROOT / "src" / "asset-definitions"`;
  - `610e101:scripts/generate-marketo-factories.py:27`: `OUTPUT = ROOT / "src" / "asset-mocks"`;
  - `610e101:scripts/generate-marketo-resources.py:59` e `:63`: imports `../../../asset-definitions/…` e `../../../asset-mocks/factories/…`.

  A diferença é só de lugar. Medido na #4, numa cópia de `origin/main`: gerados de novo, os 255 arquivos de definições e os 259 de factories saem idênticos aos commitados, só que nas pastas antigas.
- **Commits do meio com imports para pastas que não existiam.** Medido na #4 com `tsc --noEmit -p tsconfig.build.json` (TypeScript 6.0.3, a versão do lockfile) em cada commit:
  - em `a19d9d3`, 123 erros TS2307 (módulo não encontrado): os controllers e os DTOs que restaram importam os 101 apagados;
  - em `e7a0bb6`, 165: os 23 controllers ainda importam `../../../asset-definitions`, a pasta que esse commit esvaziou;
  - em `5cc5e09` e `0ef242d`, 86: os 23 services importam `../../asset-mocks/factories/*`, e `src/asset/asset-mocks/` não tem nenhum arquivo até `b91681a`.

  O movimento não foi a única quebra: nenhum commit anterior a `fb4a804` passa no `tsc`. `0c8e760` falha no TS5107 (`moduleResolution` depreciado), e de `01ee283` a `b91681a` todos falham no TS1378, o `await bootstrap()` de topo em `src/main.ts`, que `fb4a804` troca por `bootstrap()`. Não havia CI para medir: `fb4a804` não tem nenhum workflow, e os primeiros chegaram com `5b33eb2`, na #2.
- **O `check:all` não podia passar.** Medido na #4, numa cópia de `origin/main`:
  - `check:definitions` sai com 1: 255 ausentes ou alterados;
  - `check:resources` sai com 1: 46 alterados;
  - `check:factories` sai com 1: 259 ausentes.

  Por isso o `check:all` ficou fora do `npm run check` ([Check, no fluxo](../../../docs/development/workflow.md#check)), e o critério de aceite que o exige ficou aberto no [project intent](../../intent/project-intent.md#critérios-de-aceite) até a #6. E o `npm run generate:all` recriaria as pastas no layout antigo, ao lado das atuais (#7).

## O que fazer em vez disso

- **Um layout novo é uma mudança no gerador.** Mude a constante de saída e os imports relativos num commit, rode `npm run generate:all` e commite a saída regenerada no seguinte. O `npm run check:all` sai com 0 no commit da saída ([Gerar e conferir](../patterns/generate-and-check.md)).
- **Um movimento é um commit só, sem mudar o conteúdo.** O git não registra renomeações: ele as deduz por similaridade na hora do diff. Em `e7a0bb6`, a reformatação no mesmo commit deixou os 154 renomeados com 50% a 90% de similaridade, e os 101 apagados em `a19d9d3` voltaram como arquivos novos. A reformatação vai em outro commit ([Mensagem de commit que diz menos do que o commit faz](commit-message-understating-its-content.md)).
- **Todo commit compila.** Nenhum commit do meio deixa um import apontando para uma pasta que não existe. Quando a saída muda de lugar, o commit da saída leva junto a linha escrita à mão que a importa, e a mensagem diz isso: na #6, o import do seed em `src/main.ts` ([Gerar e conferir](../patterns/generate-and-check.md)).
- **Uma fonte só para os caminhos.** Desde a #6, a saída e os imports relativos saem do registro de alvos (`scripts/marketo_codegen.py:25-71`, `:154-157`), e mover uma pasta é mudar um valor ([A fronteira do código gerado](../patterns/generated-code-boundary.md)).

A [ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md) registra que o código gerado é commitado e que o Swagger é a fonte única.

## Exemplo do erro

```text
e7a0bb6  src/asset-definitions/**  ->  src/asset/asset-definitions/**   (154 renomeados, 101 recriados)
         scripts/generate-marketo-definitions.py                         (sem mudança)
```

```python
# 610e101:scripts/generate-marketo-definitions.py:23, até a #6
OUTPUT = ROOT / "src" / "asset-definitions"
# 610e101:scripts/generate-marketo-factories.py:27
OUTPUT = ROOT / "src" / "asset-mocks"
```

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
- **Atualizado**: 2026-09-26 (Fase: Build), as citações dos arquivos gerados e dos geradores seguiram as linhas novas, depois do cabeçalho de gerado (#7)
