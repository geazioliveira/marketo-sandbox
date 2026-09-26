# Anti-pattern: Editar código gerado à mão

## Resumo

Editar à mão um arquivo que um gerador emite separa o que está commitado do que o gerador produz: o `--check` passa a falhar, e a próxima regeneração desfaz a edição.

## Problema

- **A regra já estava escrita.** Desde `01ee283`, o README manda nunca editar à mão as pastas geradas e regenerá-las (`README.md:50-51`). Nenhum arquivo gerado diz que é gerado: não há cabeçalho, e a regra só existe no README. Prosa não recusa nada.
- **`5cc5e09` editou a saída do gerador de resources.** A mensagem fala só de exportar os services. O commit também:
  - trocou o prefixo dos imports dos 23 controllers, de `../../../asset-definitions` para `../../asset-definitions`;
  - trocou os stubs `NotImplementedException` dos 23 services por `return makeX()`, com imports novos de `../../asset-definitions/*` e `../../asset-mocks/factories/*`. Antes, os services só importavam `@nestjs/common`.

  A #7 registra que esse commit "editou a saída gerada à mão".
- **O gerador nem rodava nesse commit.** Os dois geradores importam `marketo_codegen` desde `a967f26`, e ele só chega em `0ef242d`, 22 segundos depois de `5cc5e09`. Medido na #4: em `5cc5e09`, os dois saem com `ModuleNotFoundError: No module named 'marketo_codegen'`.
- **Só o prefixo difere do que o gerador emite.** As factories e o `exports` são o que o código do gerador passou a emitir em `a967f26` (`scripts/generate-marketo-resources.py:189` e `:236`). O prefixo dos imports, não: o gerador ainda emite `../../../asset-definitions/…` e `../../../asset-mocks/factories/…` (`scripts/generate-marketo-resources.py:59` e `:63`), e nenhuma das duas versões commitadas dele emite `../../`: a de `0c8e760` emite `../../../asset-definitions/<categoria>/<arquivo>.js` (`0c8e760:scripts/generate-marketo-resources.py:73`).
- **O `--check` acusa a edição.** Medido na #4, numa cópia de `origin/main`: `npm run check:resources` sai com 1 e aponta 46 arquivos alterados, os 23 controllers e os 23 services. A diferença é só o prefixo dos imports, e os 23 módulos estão em dia.
- **Regenerar desfaz a edição.** O gerador apaga a pasta de saída antes de escrever (`shutil.rmtree`, `scripts/marketo_codegen.py:95`). Medido na #4: um `npm run generate:resources` devolve os 46 arquivos ao prefixo `../../../`, e o `npm run generate:all` recriaria as pastas no layout antigo, ao lado das atuais (#7).
- **O CI não vê uma edição nova.** Enquanto a #7 não fecha, o `npm run check:all` é uma falha conhecida e fica fora do `npm run check` (`docs/development/workflow.md:277`). Nada no CI compara o código gerado com o que os geradores emitem.

## O que fazer em vez disso

- **Mude o gerador, não a saída.** Uma mudança no código gerado começa em `scripts/*.py` ou no Swagger. Rode `npm run generate:<alvo>`, commite o gerador e, no commit seguinte, a saída regenerada, e prove com `npm run check:<alvo>` saindo com 0 ([Gerar e conferir](../patterns/generate-and-check.md)).
- **Comportamento fica fora das pastas geradas.** O que o gerador não emite mora ao lado do código gerado, nunca dentro ([A fronteira do código gerado](../patterns/generated-code-boundary.md) e a [ADR 0009](../../decisions/0009-behaviour-beside-generated-code.md), ainda `Proposed`).
- **Os 46 arquivos se corrigem no gerador.** A #7 é a dona disso. Ainda sem plano, ela propõe derivar a saída e os imports relativos de um registro único e pôr um cabeçalho "gerado, não edite" nos arquivos gerados, depois de conferir se a reescrita multi-API (#6) já resolve. Uma edição à mão que "conserte" os 46 arquivos repetiria o erro.
- **Na revisão, procure o sinal.** Um diff em `src/asset/asset-definitions/`, `src/asset/resources/` ou `src/asset/asset-mocks/` sem mudança em `scripts/*.py` ou em `docs/marketo-swagger-asset.json` na mesma PR é este erro. Código gerado é risco `HIGH` ([Revisão classificada por risco](../patterns/risk-classified-review.md)).

A [ADR 0004](../../decisions/0004-swagger-as-single-source-with-committed-generated-code.md) registra por que o código gerado é commitado e o Swagger é a fonte única.

## Exemplo do erro

```diff
# 5cc5e09, src/asset/resources/snippets/snippets.controller.ts: o prefixo mudou na saída
-import type { CloneSnippetRequest } from '../../../asset-definitions/requests/clone-snippet-request'
+import type { CloneSnippetRequest } from '../../asset-definitions/requests/clone-snippet-request'
```

```python
# scripts/generate-marketo-resources.py:59, que continua emitindo o prefixo antigo
return f"../../../asset-definitions/{definition_category(name)}/{definition_file(name)}"
```

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Active
