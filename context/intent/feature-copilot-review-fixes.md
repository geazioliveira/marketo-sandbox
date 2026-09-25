# Feature: Tratar os comentários abertos do Copilot nas PRs #10 e #11

## Declaração de intenção

As PRs #10 e #11 foram mergeadas com 7 threads de revisão do Copilot abertas, sem resposta e sem issue. O agente mergeou antes de a revisão chegar, e a revisão acabou cobrindo um commit que não era a cabeça.

O dono pediu que esses comentários virem uma issue e que nenhum comentário fique aberto. Esta feature trata os 7 um a um:
- corrige o que procede;
- documenta com fontes o que não procede;
- verifica os achados que aparecem só no resumo das revisões;
- responde e resolve cada thread depois do merge (resposta 2 do dono na #12).

A regra que impede isso de se repetir fica no gate, na #13.

## Critérios de aceite

- [ ] O gate lê `labels(first: 100) { totalCount nodes { name } }`. Quando `totalCount` passa do número lido, `kind` e `state-label` falham fechado, com uma mensagem que diz quantas labels ficaram sem ler. Há um teste com 101 labels, em modo local e em modo CI. O `gh` falso das specs exige `totalCount` e corta as conexões por `first`/`last`.
- [ ] No `stacked`, só a própria branch e a cópia publicada dela (mesmo nome) ficam isentas.
  - Outra branch da mesma issue que compartilha histórico não publicado bloqueia, e a mensagem manda apagá-la. Resposta 1 do dono: uma branch velha da mesma issue também bloqueia.
  - Os testes cobrem os modos local e CI.
  - A cópia publicada da própria branch continua isenta.
- [ ] O `audit-main.mjs` lê `closingIssuesReferences(first: 100)` e falha fechado, com o motivo verdadeiro, quando a página vem incompleta sem nenhuma issue deste repositório. Há teste.
- [ ] A entrada da #3 no changelog diz "113 links internos".
- [ ] `loop-gate.md`, `docs/development/workflow.md` e o JSDoc de `approveState` dizem que só os atos que abrem o gate exigem o dono.
  - Um teste prova que retirada, `# Plano` e título quase-Approve de outro autor cancelam.
  - Outro teste prova que um `# Owner Approve` de outro autor não derruba o Approve do dono.
- [ ] Os comentários 1 (`ref: main`) e 5 (`queue`) não mudam código. Os comentários no YAML citam a documentação que justifica cada escolha.
- [ ] Cada achado que aparece só no resumo das revisões é verificado. O que procede é corrigido com teste; o que não procede fica registrado nos Resultados, com a evidência:
  - checklist dentro de bloco de código;
  - sufixo com ponto no nome da branch;
  - templates sem bloco Status;
  - títulos aninhados no `check:context`.
- [ ] A PR abre em draft, sai de draft só com o Learn, e o monitor de CI do app é ligado nela. Ela espera a revisão do Copilot na cabeça e é mergeada só com todas as threads que ele abrir respondidas e resolvidas.
- [ ] Depois do merge, cada uma das 7 threads de #10 e #11 recebe uma resposta em pt-BR com o veredito e o SHA ou a evidência, e é resolvida.
- [ ] `npm run check` e o e2e passam, e o gate fica aberto.

## Abordagem técnica

- Cada correção fica do lado que bloqueia, como o resto do gate: uma conexão GraphQL lida pela metade não é julgada.
- As isenções (a) e (b) do `stacked` deixam de valer para refs da mesma issue com outro nome, porque os commits dos dois lados citam `#N` e o histórico não diz qual foi cortada de qual.
- Os comentários que não procedem não mudam código: a resposta na thread e o comentário no YAML levam a fonte.

## Perguntas em aberto

Respondidas pelo dono no Approve da #12 (2026-09-25), "seguindo suas recomendações":

1. Uma branch velha da mesma issue, com outro nome, bloqueia.
2. O agente responde e resolve as 7 threads depois do merge.
3. A ordem é #12 → #13 → #4 → #5.

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md): uma issue, uma branch.
- [0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #12 (#12)
- **Status**: In Progress
