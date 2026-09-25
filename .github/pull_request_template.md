Closes #
<!--
A primeira linha acima precisa ficar exatamente "Closes #<número da issue>.", com o ponto final e nada antes dela, nem este comentário. Fica em inglês porque o GitHub só reconhece palavras-chave de fechamento em inglês.

A PR fecha exatamente a issue da branch (feature/<número>-<slug> ou fix/<número>-<slug>) e nenhuma outra: não use Closes, Fixes ou Resolves para outra issue em nenhum lugar deste texto.

A PR fica em draft até o commit de Learn (intent com Resultados e entrada no changelog), e só então sai de draft.
-->

## Risco

<!-- HIGH ou NORMAL, e o raciocínio. O risco decide a profundidade da revisão. Uma PR que toca .github/workflows/ é HIGH, seja qual for o risco do plano. -->

## O que mudou

<!-- O que mudou e por quê, na ordem dos commits. -->

## Verificação

<!-- Os checks realmente rodados, cada um com a saída. Nunca relate um check que não rodou; um check pulado aparece como não rodado. -->

## Desvios do plano aprovado

<!-- O que saiu diferente do plano da issue, e por quê. Escreva "Nenhum" se não houver. -->

## Follow-ups

<!-- O que ficou para depois, cada item com a sua issue. -->

## Context Mesh

- [ ] Intent atualizado em `context/intent/` (Resultados e status)
- [ ] Entrada em `context/evolution/changelog.md` com `(#N)` no título
- [ ] Decisões registradas em `context/decisions/`
- [ ] Patterns e anti-patterns extraídos em `context/knowledge/`
- [ ] Comentário de progresso na issue mãe (quando houver)
