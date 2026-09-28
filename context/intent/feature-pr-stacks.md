# Feature: Stack de PRs, com cada fatia numa sub-issue da issue mãe

## Declaração de intenção

Uma mudança grande pode ser entregue numa stack de PRs pequenas, uma sobre a outra, cada uma com revisão e merge próprios. A PR #26, da #5, mostrou o custo de não poder: dez revisões do Copilot sobre cerca de 34 mil linhas, com um achado numa parte segurando o merge de todas as outras. O dono fechou a PR em 2026-09-27 e pediu a #5 de volta como stack. Hoje o loop recusa uma branch cortada de outra.

A stack entra no loop sem afrouxar o vínculo com issue:

- cada fatia é uma sub-issue da issue mãe, e cada PR fecha a sua;
- o Approve do plano da mãe, que lista as fatias numa seção `Stack`, vale para elas;
- toda revogação desse Approve vale para todas as fatias.

## Critérios de aceite

- [x] Uma issue mãe declara uma stack com uma seção `Stack` no plano vigente: a lista ordenada das branches das fatias, de baixo para cima, cada uma nomeando uma sub-issue da mãe.
- [x] Uma sub-issue de fatia leva a label de categoria e a label `stack-slice`, sem label de estado. O gate lê, para ela, o estado, as seções, os critérios e o Approve da mãe. Ele exige que a sub-issue seja filha da mãe, que as duas estejam abertas, e que a branch esteja na `Stack` do plano vigente da mãe. Uma branch fora da `Stack`, ou uma mãe sem Approve, é recusada.
- [x] Editar o plano da mãe depois do Approve, ou postar nela um `# Plano` novo, revoga o Approve de todas as fatias, como já revoga o da mãe.
- [x] A PR de uma fatia pode ter como base a branch da fatia logo abaixo na `Stack`, ou `main`. Com a base na fatia de baixo, ela fica em draft; sai de draft só quando a de baixo mergeia e a PR passa a apontar para `main`.
- [x] O `stacked` aceita as refs das fatias de baixo da mesma `Stack`, e o merge de uma delas na fatia de cima, para trazer correções, não conta como merge estranho. Qualquer outra ref continua recusada.
- [x] O `intent-first` bloqueia só na primeira fatia. O `learn` bloqueia só na última, com a entrada do changelog citando a mãe. Nas outras fatias, os dois só relatam.
- [x] Um evento na issue mãe (o Approve, uma label, um plano) re-executa o `issue-link` das PRs abertas que fecham as sub-issues dela.
- [x] Um passo novo, `pr-size`, só relata as linhas alteradas da PR contra a base, com um teto de referência de 1.500 linhas.
- [x] O `test/scripts/gate.spec.ts` cobre a primeira fatia, uma do meio e a última, a base na fatia de baixo com e sem draft, o merge da fatia de baixo, uma branch fora da `Stack`, uma mãe sem Approve, uma sub-issue de outra mãe e um plano revisado na mãe depois do Approve.
- [x] A ADR 0001, o ciclo de vida de issue e branch, o gate do loop, o fluxo e o glossário descrevem como montar, revisar, atualizar e mergear uma stack.

## Abordagem técnica

A branch `feature/31-pr-stacks` nasce de `origin/main`. Depois deste commit, que só toca `context/intent/`, vêm:

1. os contratos em `scripts/loop-sections.mjs`: a seção opcional `Stack`, a label `stack-slice` e a posição de uma branch na stack;
2. o gate (`scripts/gate.mjs`), com os testes em `test/scripts/gate.spec.ts`: a leitura da mãe numa fatia, o `pr-base`, o `stacked`, o `intent-first` e o `learn` pela posição da fatia, e o `pr-size`;
3. o refresh, que passa a re-executar também as PRs das sub-issues da issue do evento;
4. a label `stack-slice`, criada com `gh label create`;
5. as docs e o Learn.

## Perguntas em aberto

Nenhuma. O Approve do dono na #31 (2026-09-27, "Pode seguir com suas recomendações") ficou com as cinco recomendações do plano:

- a seção `Stack` e a label `stack-slice`;
- a PR de cima em draft até a de baixo mergear;
- o `intent-first` só na primeira fatia e o `learn` só na última;
- o teto de 1.500 linhas do `pr-size`, só relatado;
- a ordem: a #31, depois a stack da #5, depois a #30.

## Decisões relacionadas

- [ADR 0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Revisão classificada por risco](../knowledge/patterns/risk-classified-review.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md), e a PR é a #33.

Desvios do plano, da verificação adversarial feita antes da PR e da revisão do Copilot nela, sempre para o lado que bloqueia:

- **A ordem do merge é conferida.** Uma fatia acima da primeira só aponta para `main` depois de toda fatia de baixo mergeada. O plano só dizia que a de cima ficava em draft até a de baixo mergear, e uma fatia apontada para `main` antes disso levaria as de baixo junto, sem o gate delas.
- **Os commits de uma fatia acima da primeira precisam citar a sub-issue dela**, no CI fora de draft. Ali o `intent-first`, que só bloqueia na primeira fatia, já não pega uma branch cortada de trabalho de fora da stack.
- **A isenção de uma fatia de cima tem condição.** A ref dela só fica fora do `stacked` quando o que ela divide com o HEAD, fora de `main` e das fatias de baixo, cita a issue desta fatia. Isentar toda fatia de cima deixava passar uma fatia de baixo que trouxe os commits da de cima.
- **A `Stack` tem formato estrito.** Só os itens numerados na primeira coluna, começando pela branch num code span, de uma crase ou de mais, são fatias, e um bullet, um item indentado ou um parágrafo é prosa. Antes, uma nota que citasse uma branch virava fatia e a isentava do `stacked`. Duas branches da mesma issue e a branch da própria mãe bloqueiam.
- **A mãe precisa ser deste repositório.** Uma mãe que não se lê, por qualquer falha, deixa o veredito não verificado, com aviso no modo local quando o GitHub está inacessível. O refresh deixa de fora as sub-issues de outro repositório e as que não levam `stack-slice`.
- **A mãe precisa ser a raiz.** Uma mãe que também leva `stack-slice` é recusada, porque uma stack não se aninha. Ela precisa de exatamente uma label de categoria, que dá as seções do plano. As duas regras vieram da primeira revisão do Copilot na PR #33.
- **Toda branch da `Stack` é de uma fatia da mãe.** O gate confere cada uma contra as sub-issues da mãe, deste repositório e com `stack-slice`, lidas inteiras. Sem isso, uma branch de fora, citada na `Stack`, passaria por fatia de baixo ou de cima. O critério já pedia isso, mas o gate só conferia a branch julgada; a falta veio da segunda revisão do Copilot.
- **Uma falha do git não isenta.** Um `git merge-base` que falha bloqueia o `stacked`, e só a saída 1, sem commit em comum, conta como nada em comum. Antes, a falha isentava uma fatia de cima e passava no teste geral, que é de antes da #31. Veio da terceira revisão do Copilot, que também achou a contagem de rodadas da #26 neste intent, agora dez.
- **O tamanho.** Depois das revisões do Copilot, são cerca de 3,6 mil linhas contra `main`, mais de 2,3 mil delas em testes, acima da referência de 1.500 que a própria #31 criou. Ela não podia vir numa stack, porque é ela que ensina o loop a aceitar uma.
- **Um relato novo, de antes da #31**: a #32, o remédio errado que o `stacked` dá a um merge de fora quando a branch já foi publicada. Só a mensagem está errada, e o veredito está certo.
- **Um anti-pattern novo**: [uma PR que prende partes independentes](../knowledge/anti-patterns/one-pr-for-many-independent-parts.md), dos fatos da PR #26.

O gate numa fatia e o refresh das sub-issues estão provados com o GitHub falso do `gate.spec.ts` e do `refresh-issue-link.spec.ts`. Ao vivo, eles rodam pela primeira vez na stack da #5.

## Status

- **Criado**: 2026-09-27 (Fase: Intent), do plano aprovado na issue #31 (#31)
- **Status**: Completed
- **Atualizado**: 2026-09-27 (Fase: Learn), os critérios provados no `gate.spec.ts`, no `loop-sections.spec.ts` e no `refresh-issue-link.spec.ts`, com o `npm run check` e o e2e verdes na PR #33 (#31)
