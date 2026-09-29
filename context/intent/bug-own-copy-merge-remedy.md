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

- [ ] Com a branch publicada, um merge de outra branch recebe, no CI e no modo local, o remédio de cortar a branch de `origin/main`.
- [ ] Um merge da própria cópia publicada (um `git pull` que fez um merge) continua recebendo o remédio do rebase antes do push. Depois do push, o remédio é o recorte e não afirma que o merge trouxe a cópia publicada.
- [ ] O `test/scripts/gate.spec.ts` cobre os dois casos, antes e depois do push, nos dois modos, e os casos novos falham em `d50fd00`.
- [ ] O veredito do `stacked` não muda em nenhum caso do `gate.spec.ts`.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md), o gate como o conferente do loop

## Resultados

- A escrever no Learn.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano vigente na issue #32 (#32)
- **Status**: In Progress
- **Atualizado**: 2026-09-29 (Fase: Intent), o plano aprovado com a recomendação da pergunta 1 (#32)
