# Changelog

Uma entrada por mudança mergeada, da mais nova para a mais antiga, escrita no passo Learn da branch que fez a mudança. O formato está no [guia do Context Mesh](../README.md). O que veio antes do loop (de `0c8e760` a `fb4a804`) ganha uma entrada retroativa com a #4.

---

## 2026-09-24: Loop issue-first com gate e vínculo PR↔issue (#2)

**Fase**: Learn
**Tipo**: Process

### O que foi construído / corrigido

- **Context Mesh no repositório.** O guia (`context/README.md`), o índice de decisões e as ADRs [0001](../decisions/0001-context-mesh-in-the-repository.md) e [0002](../decisions/0002-soft-enforcement-on-github-free.md), o project intent, o intent desta feature, dois patterns e um anti-pattern.
- **O gate do loop** (`npm run gate`, `scripts/gate.mjs`). Os contratos têm uma fonte única, `scripts/loop-sections.mjs`, que o gate, os forms, o CI e os testes importam. A issue é lida por GraphQL. O gate tem um modo local, que degrada sem rede e grava o cache, e um modo CI, que falha fechado.
- **Os três defeitos do gate do lite-campaign, corrigidos:**
  - brunohab/lite-campaign#124: o Learn exige um título de entrada novo;
  - brunohab/lite-campaign#122: o `stacked` vê toda ref que compartilha commits fora do `origin/main`, inclusive `claude/*` e o `main` local à frente;
  - brunohab/lite-campaign#103: exatamente uma label de estado, e um `gh` falso estrito.
- **CI:**
  - `Vínculo com issue / issue-link` roda em `pull_request_target`: o YAML e o gate vêm de `main`, e a PR entra só como dados;
  - `Qualidade / check` roda lint e testes.
- **Issue forms** em pt-BR, com rótulos iguais aos títulos que o gate lê, e o **template de PR**, que começa com `Closes #`.
- **Roteamento e loop:** `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`) e `docs/development/workflow.md`, com o loop de 9 passos, o encaixe do plan mode, o cookbook do `gh`, as labels e as regras de merge.
- **Configurações do repositório**, aplicadas com o OK do dono na #2: só merge commit, a branch é apagada no merge, e o merge commit leva o título e o corpo da PR. As labels `needs-triage`, `needs-info`, `ready-for-human` e `ready-for-agent`.

### Números medidos

- `npx vitest run`: 418 testes em 5 arquivos, todos verdes.
- `node scripts/gate.mjs --json --no-cache` na branch `feature/2-loop-minimo`: `open: true`, `verified: true`, `blocked: []`. O Approve do dono (2026-09-24T22:08:39Z) e a label aplicada depois dele (22:08:53Z) foram lidos ao vivo.
- Cada correção feita depois das revisões tem um teste de regressão que falha quando ela é revertida. Isso foi medido revertendo cada correção numa cópia fora do worktree.

### Decisões tomadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md): o plano vive na issue, o Approve é do dono, uma issue vira uma branch que vira uma PR, o merge é por merge commit e não existe lane sem issue.
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md): as camadas, o que cada uma cobre e os limites. Os hooks chegam com a #5, e a auditoria de `main` e o refresh do check, com a #3.

### Patterns aplicados ou criados

- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) (criado)
- [O gate do loop](../knowledge/patterns/loop-gate.md) (criado)
- [Dublê de teste estrito na camada errada](../knowledge/anti-patterns/test-double-strict-on-the-wrong-layer.md) (anti-pattern criado)

### Aprendizados / surpresas

- **Revisão adversarial rende.** Três rodadas de revisão e verificação acharam mais de 30 defeitos reais e distintos num gate que já passava em todos os testes. Os mais graves: o `stacked` abria logo depois do corte, e o `gh` falso respondia campos que o gate não tinha pedido. Toda regra que decide abrir o gate precisa de um caso que falha quando ela é removida.
- **Em dúvida, bloquear.** Uma retirada de Approve escrita com uma letra diferente passava em silêncio. Agora qualquer título que mencione "approve" e não seja o Approve exato cancela o Approve em pé, e o dono reaprova.
- **`updatedAt` não serve para detectar edição.** Ele muda com label e com comentário. O que serve é `lastEditedAt`, lido por GraphQL.
- **Worktrees do Claude Code nascem do HEAD do checkout principal**, não de `origin/main`. Toda branch é cortada de `origin/main`, e o upstream que aponta para `origin/main` é removido.
- **A PR ficou maior que o previsto**, com cerca de 8,5 mil linhas em vez de 3 mil, quase tudo em testes. O plano deveria estimar os testes de um gate à parte.
