# Anti-pattern: Dublê de teste estrito na camada errada

## Resumo

Um dublê de teste que confere com rigor **como** é chamado, mas responde a mesma coisa seja qual for **o que** se pede, deixa passar a regressão que mais importa.

## Problema

O `gh` falso do gate (`test/support/fake-gh.mjs`) nasceu estrito nos argumentos: qualquer argv inesperado saía com 97, e esse rigor é a correção de brunohab/lite-campaign#103. Só que ele devolvia o fixture inteiro, qualquer que fosse a consulta GraphQL. Na revisão adversarial da #2, alguém tirou `lastEditedAt` e `__typename` da consulta do gate, e os 96 casos de `gate.spec.ts` continuaram verdes.

Com o `gh` de verdade, essa mudança desligaria em silêncio as regras "corpo editado depois do Approve" e "Approve de bot", e o gate passaria a abrir. Ou seja, falharia aberto. O rigor estava na camada que não carregava o risco: o risco estava nos campos pedidos, e os argumentos não mostravam isso.

## O que fazer em vez disso

- O dublê responde **só o que foi pedido**. O `gh` falso agora remove do fixture todo campo que a consulta não selecionou, e sai com 97 quando a consulta deixa de pedir um campo do qual o gate depende.
- Para cada regra que depende de um dado externo, escreva um caso de mutação: tire o campo da consulta e confirme que algum teste falha.
- Ao revisar um dublê, pergunte o que acontece se o código em teste pedir **menos**, e não só se ele pedir de um jeito diferente.

Veja [o gate do loop](../patterns/loop-gate.md), que descreve os testes.

## Exemplo do erro

```js
// Antes: estrito no argv, cego ao que a consulta seleciona.
if (!argvMatches(expected)) exit(97)
print(JSON.stringify(fixture)) // o fixture inteiro, pedido ou não
```

## Status

- **Criado**: 2026-09-24 (Fase: Learn), da revisão adversarial da implementação da #2 (#2)
- **Status**: Active
