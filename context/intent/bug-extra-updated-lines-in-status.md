# Bug: Arquivos fora das decisões guardam mais de uma linha Atualizado, e o check:context não confere

## Descrição

- **Esperado.** O bloco Status segue o [guia](../README.md#o-bloco-status): uma decisão guarda todas as linhas `Atualizado`, da mais antiga para a mais nova, e os outros arquivos tipados guardam só a última. Um arquivo fora da regra deixa o `npm run check` vermelho.
- **Atual.** Em `main` (`624eafa`), dos 43 arquivos tipados que não são decisão, 9 têm de 2 a 4 linhas `Atualizado`: `feature-plan-validation-labels.md`, `feature-review-gate.md`, `project-intent.md` e `feature-claude-code-hooks.md` em `intent/`, e `risk-classified-review.md`, `generate-and-check.md`, `issue-branch-lifecycle.md`, `generated-code-boundary.md` e `loop-gate.md` em `knowledge/patterns/`. O `check:context` passa assim mesmo. O commit `deace73` da #24 usou as duas formas: em cinco arquivos, trocou a última linha, como o guia pede, e em dois acrescentou uma linha abaixo das outras. No `risk-classified-review.md`, a troca levou a linha da #5 e deixou a da #7 acima, então o arquivo ficou com duas linhas.
- **Reprodução.** O laço de `grep -c '^- \*\*Atualizado\*\*'` sobre `context/intent/`, `context/knowledge/*/` e `context/agents/`, da issue #66, lista os nove arquivos, e o `npm run check:context` sai com 0. Os testes desta issue montam um arquivo de cada tipo com duas linhas e esperam a recusa.

## Causa raiz

- **A regra só está na prosa do guia.** O `check:context` acha o bloco Status, recusa uma seção depois dele e lê só a linha `- **Status**:` (`scripts/check-context.mjs:699-796`). Nenhuma conferência lê as linhas `Atualizado`: nem quantas há fora das decisões, nem a ordem das datas dentro delas.
- **O contrato não diz quem guarda todas as linhas.** Em `scripts/loop-sections.mjs`, o bloco tem `statusHeading`, `statusLine` e `statusDeclaration`, e o `contextKinds` diz o título e os status de cada tipo, mas nada diz que só a decisão guarda todas as linhas `Atualizado`.
- **Cada Learn escolhe a forma.** Quem escreve decide entre acrescentar, como numa decisão, e trocar, e o `npm run check` aceita as duas. A primeira linha a mais entrou em `main` com a PR #33 (#31, `b96caad`).

## Abordagem da correção

- **O contrato.** `scripts/loop-sections.mjs` ganha `statusUpdatedLine`, o formato estrito com a data capturada, e `statusUpdatedDeclaration`, qualquer linha que declara `Atualizado`, no molde de `statusDeclaration`. O tipo `ADR` do `contextKinds` ganha `keepsEveryUpdate: true`.
- **O guarda.** No passo (b) do `check:context`, dentro do bloco Status e só na prosa:
  - toda linha que declara `Atualizado` precisa estar no formato estrito;
  - fora dos tipos com `keepsEveryUpdate`, uma segunda linha é recusada;
  - a data de cada linha não vem antes da linha de cima, contando o `Criado` como a primeira data, e o mesmo dia pode repetir.
- **Os nove arquivos.** Cada um fica só com a última linha `Atualizado` que tinha, sem linha nova da #66.
- **O guia.** O [bloco Status](../README.md#o-bloco-status) passa a dizer que o `npm run check:context` confere a regra.

O plano vigente e o Approve do dono estão na #66. O dono aprovou as três recomendações: conferir a ordem das datas, manter a última linha de cada arquivo e fazer tudo numa PR só. A branch é `fix/66-linhas-atualizado-a-mais`, cortada de `origin/main` em `624eafa`.

## Critérios de aceite

- [ ] Nenhum arquivo tipado fora de `context/decisions/` tem mais de uma linha `Atualizado`, e os nove arquivos mantêm a última linha que tinham.
- [ ] O `check:context` recusa uma segunda linha `Atualizado` num intent, num pattern, num anti-pattern ou num agente, com `arquivo:linha`. O teste falha antes e passa depois.
- [ ] O `check:context` aceita todas as linhas `Atualizado` de uma decisão, duas do mesmo dia inclusive, e recusa uma linha datada antes da de cima ou do `Criado`. Os testes falham antes e passam depois.
- [ ] Dentro do bloco Status, uma linha `Atualizado` fora do formato é recusada, e um item numerado, uma citação ou o negrito com `__` contam como linha `Atualizado`. Em código ou em comentário HTML, a linha não conta.
- [ ] Rodado contra a árvore de antes da limpeza, o guarda lista os nove arquivos, e só eles.
- [ ] O `npm run check`, o e2e e o gate passam.
- [ ] O guia, o cabeçalho do `check-context.mjs`, o intent e o changelog registram a regra conferida.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #66 (#66)
- **Status**: In Progress
