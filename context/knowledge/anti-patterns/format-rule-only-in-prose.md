# Anti-pattern: Regra de formato escrita só na prosa do guia

## Resumo

Escrever no guia uma regra de formato que nenhum check lê. Cada Learn decide sozinho se a segue, os arquivos se dividem entre as formas, e o `npm run check` continua verde.

## Problema

Desde `8e17c98` (2026-09-24), o [guia](../../README.md#o-bloco-status) diz que só uma decisão guarda todas as linhas `Atualizado` do bloco Status, e que os outros arquivos guardam só a última. Até a #66, o `check:context` lia do bloco só a linha `- **Status**:`.

Em cinco dias, nove arquivos que não são decisão passaram a guardar de 2 a 4 linhas. A primeira linha a mais entrou com a PR #33 (#31, `b96caad`). No commit `deace73`, a #24 usou as duas formas: trocou a linha em cinco arquivos e acrescentou em dois.

Ao ver a troca, o dono a tomou por uma perda de linhas e pediu para restaurá-las. A conferência mostrou que a troca era a regra, e que o defeito estava nos nove arquivos que acrescentavam (#66). Com os arquivos divididos, ler um arquivo já não dizia qual era a regra.

## O que fazer em vez disso

- **Uma regra de formato que um script consegue ler entra no check na mesma PR que a escreve no guia.** O contrato fica em `scripts/loop-sections.mjs`, como pede o cabeçalho dele, e o guia diz que o check confere. Desde a #66, o `check:context` confere as linhas `Atualizado`.
- **Ao achar uma regra do guia sem check, meça a árvore inteira antes de corrigir um arquivo.** Uma regra sem check raramente deriva num lugar só.
- **Antes de restaurar o que parece perdido, confira a regra no guia.** O que parece perda pode ser a regra aplicada.
- Um check que confere só uma parte do formato tem o mesmo defeito na parte que não confere: [um check que só compara a saída derivada](check-that-only-compares-derived-output.md) deixa passar a mudança na origem.

## Exemplo do erro

```text
context/README.md:84              "Os outros arquivos mantêm só a última"
scripts/check-context.mjs         lê do bloco Status só a linha "- **Status**:"
knowledge/patterns/loop-gate.md   4 linhas Atualizado (#17, #31, #5, #30)
npm run check:context             nenhum problema
```

## Status

- **Criado**: 2026-09-29 (Fase: Learn), das linhas Atualizado a mais que o check:context não conferia (#66)
- **Status**: Active
