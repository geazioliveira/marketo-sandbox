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

- [x] Nenhum arquivo tipado fora de `context/decisions/` tem mais de uma linha `Atualizado`, e os nove arquivos mantêm a última linha que tinham.
- [x] O `check:context` recusa uma segunda linha `Atualizado` num intent, num pattern, num anti-pattern ou num agente, com `arquivo:linha`. O teste falha antes e passa depois.
- [x] O `check:context` aceita todas as linhas `Atualizado` de uma decisão, duas do mesmo dia inclusive, e recusa uma linha datada antes da de cima ou do `Criado`. Os testes falham antes e passam depois.
- [x] Dentro do bloco Status, uma linha `Atualizado` fora do formato é recusada, e um item numerado, uma citação ou o negrito com `__` contam como linha `Atualizado`. Em código ou em comentário HTML, a linha não conta.
- [x] Rodado contra a árvore de antes da limpeza, o guarda lista os nove arquivos, e só eles.
- [x] O `npm run check`, o e2e e o gate passam.
- [x] O guia, o cabeçalho do `check-context.mjs`, o intent e o changelog registram a regra conferida.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)

## Resultados

Os commits seguem os passos do plano: o intent (`9fa71f5`), os testes que falham (`7b837a8`), a limpeza dos nove arquivos (`f5573a5`), o guarda (`c647ed4`) e este Learn.

- **Antes do guarda**, em `7b837a8`, 21 casos novos do `test/scripts/check-context.spec.ts` falharam: os 20 do grupo (b) e o que confere a regra no guia. Os dois casos que só aceitam, a decisão com várias linhas e as linhas em código ou em comentário, já passavam, e continuam passando.
- **A prova contra a árvore de antes da limpeza.** O guarda novo rodou numa cópia de `22059b6` e numa de `624eafa`, as duas fora do git. Em cada uma, saíram 16 problemas, todos de linha `Atualizado` a mais, só nos nove arquivos: 3 em `generated-code-boundary.md` e em `loop-gate.md`, 2 em `feature-claude-code-hooks.md`, `generate-and-check.md` e `issue-branch-lifecycle.md`, e 1 nos outros quatro. São as 16 linhas que o `f5573a5` tirou. Nenhuma decisão ficou fora de ordem, e nenhuma linha fora do formato.
- **Depois**, os 137 casos do `check-context.spec.ts` passam, e o `check:context` da branch sai sem problema.
- **O `npm run check` e o e2e.** Com a média de carga entre 18 e 24, o `npm test` deu 8 falhas em 3.855 casos, todas por prazo, em `session-context`, `build-guard`, `repo` e `guard-bash`, specs dos hooks que esta PR não toca (#59). Rodados de novo, os 705 casos desses quatro arquivos passaram. Passaram o lint, o `format:check`, o typecheck, o `check:context`, o build, o `check:all` e o e2e, com 447 casos em 6 arquivos.
- **O que entrou.** Em `scripts/loop-sections.mjs`: `statusCreatedLine`, `statusUpdatedLine`, `statusUpdatedDeclaration`, `statusPhases` e o `keepsEveryUpdate` do tipo `ADR`, que o `contextKindOf` devolve. A `statusDeclaration` passou a sair do mesmo construtor da `statusUpdatedDeclaration`, com o mesmo regex, o que foi conferido pelo `source`. No passo (b) do `check:context`, cada linha que declara `Atualizado` no bloco Status precisa estar no formato do guia, com uma data de calendário. Fora das decisões, toda linha depois da primeira é recusada. Nenhuma data vem antes do `Criado` nem da mais nova acima dela.
- **As mutações**, numa cópia da árvore fora do git. Lá, o único caso que falha sem mutação é o que precisa do git (`check-ignore`). Cada mutação foi pega:

  | Mutação | Falhas a mais |
  | --- | ---: |
  | Sem a contagem fora das decisões | 8 |
  | Sem o formato | 10 |
  | Sem a ordem | 4 |
  | Sem o `Criado` como piso | 2 |
  | Toda data aceita como de calendário | 1 |
  | Só a linha estrita conta | 9 |
  | Ler código e comentário como prosa | 1 |
  | A mesma data passa a citar a última linha | 1 |
  | A referência desce depois de uma linha fora de ordem | 1 |

- **Onde se afastou do plano.**
  - A ordem é conferida contra a data mais nova acima, não só contra a linha de cima. Assim, uma linha fora de ordem não baixa a régua para as de baixo. As duas últimas mutações da tabela sobreviviam, e o commit do guarda ganhou o caso `holds every decision Atualizado line to the latest date above it, naming its first line`.
  - O teste do guia, escrito no `7b837a8`, cortava a seção no `## Status` do exemplo cercado. O commit do guarda o fez cortar no `## Templates`, como o teste vizinho.
  - A seção Check do [fluxo](../../docs/development/workflow.md#check) lista o que o `check:context` recusa e ganhou a regra nova. O plano não a citava, mas sem ela a lista derivaria.
  - O `context/README.md` já estava fora do Prettier em `main`, e o `format:check` não cobre `context/`, então o guia ficou sem reformatação.
  - O worktree precisou de `npm ci`. Sem ele, o typecheck resolvia o `node_modules` do checkout principal, anterior à #24, e acusava os tipos do `multer`.
- **O Build pediu o dono presente.** No modo automático, o hook negou a edição de `scripts/loop-sections.mjs`. A sessão saiu do modo automático, e cada edição no harness passou pela confirmação do dono.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #66 (#66)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Learn), critérios cumpridos na branch `fix/66-linhas-atualizado-a-mais`, com os Resultados, a prova contra a árvore de antes da limpeza e o anti-pattern novo (#66)
