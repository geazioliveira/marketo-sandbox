# Bug: Com a branch publicada, todo merge de fora recebe o remédio do merge da própria cópia

## Descrição

- **Esperado.** Quando uma branch traz um merge de fora de `origin/main`, o `stacked` bloqueia, e o remédio diz como consertar. O merge de outra branch pede para cortar a branch de `origin/main`. O merge da cópia publicada da própria branch (um `git pull` que fez um merge) pede o rebase enquanto ainda não foi publicado. Depois do push, o remédio não afirma o que o gate não consegue distinguir.
- **Atual.** Em `d50fd00`, com a branch publicada, local ou no CI (`--pr`), todo merge de fora recebe "o merge trouxe a cópia publicada desta própria branch: desfaça-o e traga essa cópia com git pull --rebase (ou --ff-only)". Isso vale inclusive para o merge de outra branch, e é o que o check `issue-link` mostra, porque no CI a branch está sempre publicada.
- **Reprodução.** Os casos novos do `stacked` no `test/scripts/gate.spec.ts`, que falham em `d50fd00`.

## Causa raiz

O `ownCopyMerge` (`d50fd00:scripts/gate.mjs:1827-1840`) toma um merge de fora como merge da cópia publicada quando todo pai extra dele é ancestral de `origin/main` ou de `origin/<branch>`.

Antes do push, `origin/<branch>` é a cópia de antes do merge, e só a cópia publicada é ancestral dela. Depois do push, `origin/<branch>` contém o próprio merge, e todo pai de todo merge da branch é ancestral dele.

## Abordagem da correção

A branch `fix/32-remedio-do-merge-de-fora` nasce de `origin/main` em `d50fd00` e segue o plano vigente da #32, com a recomendação aceita no Approve:

1. **Os testes, vermelhos**, no `describe` do `stacked`: o merge de outra branch com a branch publicada, local e no CI; o merge da própria cópia depois do push, local e no CI.
2. **A correção.** Um merge só conta como merge da cópia publicada enquanto essa cópia ainda não o contém (`!isAncestor(merge, origin/<branch>)`). Com o merge já publicado, o remédio é o recorte que o gate já dá para um merge de fora.
3. **A documentação**, no pattern do gate do loop.
4. **Learn.**

## Critérios de aceite

- [x] Com a branch publicada, um merge de outra branch recebe, no CI e no modo local, o remédio de cortar a branch de `origin/main`.
- [x] Um merge da própria cópia publicada (um `git pull` que fez um merge) continua recebendo o remédio do rebase antes do push. Depois do push, o remédio é o recorte e não afirma que o merge trouxe a cópia publicada.
- [x] O `test/scripts/gate.spec.ts` cobre os dois casos, antes e depois do push, nos dois modos, e os casos novos falham em `d50fd00`.
- [x] O veredito do `stacked` não muda em nenhum caso do `gate.spec.ts`.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), o gate como o conferente do loop

## Resultados

- **O que foi construído**, na branch `fix/32-remedio-do-merge-de-fora`:
  - `b794cb0`: este intent;
  - `f6737db`: dois casos novos no `stacked` do `test/scripts/gate.spec.ts`, vermelhos em `d50fd00`. O merge de outra branch com a branch publicada e o merge da própria cópia depois do push davam, no modo local e no CI, "o merge trouxe a cópia publicada desta própria branch" com `git pull --rebase`;
  - `c1aef2c`: a correção em `scripts/gate.mjs`. O `ownCopyMerge` passou a exigir, de cada merge de fora, que a cópia publicada ainda não o contenha (`!isAncestor(merge, origin/<branch>)`). Um merge já publicado recebe o recorte que o gate já dava para um merge de fora, como o Approve aceitou na pergunta 1;
  - `34bcd07`: o pattern [O gate do loop](../knowledge/patterns/loop-gate.md) diz que o rebase vale antes do push, e o recorte depois;
  - `b740e7c`: o primeiro caso novo passou a conferir também o recorte antes do push;
  - o Learn: este intent e o changelog.
- **A causa raiz se confirmou.** Depois do push, `origin/<branch>` contém o próprio merge, e todo pai de todo merge da branch é ancestral dele. Só enquanto o merge não foi publicado a ancestralidade separa a cópia publicada de outra branch.
- **Medido**, antes de escrever o plano, com um caso temporário: o merge de outra branch passou a receber o recorte nos três momentos (local antes do push, local depois do push e no CI), e o merge da própria cópia o rebase antes do push e o recorte depois, local e no CI. Com a correção, o `gate.spec.ts` e o `drift.spec.ts` passam com 567 de 567, e o veredito do `stacked` não mudou em nenhum caso.
- **Desvios do plano aprovado:**
  - o caso do merge da própria cópia antes do push ficou no teste que já existia, como o plano previa, e o do merge de outra branch antes do push ganhou a asserção do recorte no primeiro caso novo. No CI não existe "antes do push": ali a branch está sempre publicada;
  - a prova do plano foi feita, por engano, no worktree da branch, antes do Approve. O dono desfez as duas mudanças, e o `build-guard` não tinha interceptado a escrita por um script Python.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano vigente na issue #32 (#32)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Learn), o remédio do `stacked` para um merge de fora já publicado passou a ser o recorte, e o rebase ficou só para o merge da própria cópia ainda não publicado (#32)
