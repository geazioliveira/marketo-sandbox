# ADR 0001: Context Mesh no repositório e loop issue-first

## Contexto

- Até 2026-09-24, os nove commits deste repositório (de `0c8e760` a `fb4a804`) entraram direto em `main`, sem issue e sem PR. Um deles, `5cc5e09`, fez mais do que a mensagem dizia, e nada no processo mostrou isso.
- A regra global de Context Mesh da máquina do dono mantinha os arquivos de contexto num vault externo. Lá eles ficavam invisíveis para o CI, para a revisão de PR e para qualquer outro clone, então o contexto nunca era revisado junto com o código que descreve.
- O lite-campaign, que consome este mock, já trabalha assim: Context Mesh no repositório (a ADR 0007 de lá) e um gate do loop desde brunohab/lite-campaign#101. O gate de lá tem três defeitos conhecidos, brunohab/lite-campaign#124, #122 e #103, corrigidos aqui.
- Em 2026-09-24, o dono pediu: **"nunca um plano nasce fora do GitHub issues, e toda PR é vinculada a uma issue"**. As decisões dele estão registradas na issue de acompanhamento #1 e nas respostas da #2.

## Decisão

- **O ciclo.** O trabalho segue Intent, Build e Learn, com Plan, Approve e Execute dentro do Build. O loop de nove passos do [fluxo de desenvolvimento](../../docs/development/workflow.md) é a forma concreta desse ciclo.
- **O contexto mora no repositório.** Os arquivos de Context Mesh ficam em `context/`, commitados e revisados como código. O [guia do Context Mesh](../README.md) guarda o layout, os templates, o idioma e o vocabulário de status.
- **Todo plano nasce numa issue deste repositório.** Um plano escrito no plan mode do Claude Code ou numa conversa só passa a contar depois de postado na issue.
- **Toda PR fecha exatamente uma issue**, a da branch, e a primeira linha do corpo da PR é `Closes #N.`.
- **Não existe lane `batch/`.** Toda mudança, por menor que seja, tem a sua issue.
- **Uma issue, uma branch.** `feature/<número>-<slug>` ou `fix/<número>-<slug>`, cortada do `origin/main`. O [ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md) dá os detalhes.
- **Uma mudança grande vem numa stack.** Cada fatia é uma sub-issue da issue mãe, com a label `stack-slice` no lugar da label de estado, e tem a própria branch, cortada da fatia logo abaixo, e a própria PR, que fecha só essa sub-issue. O plano da mãe declara a stack numa seção `Stack`, com as branches de baixo para cima, e o Approve da mãe vale para todas as fatias. A PR de uma fatia fica em draft, com base na fatia de baixo, até essa ser mergeada. Fora de uma stack declarada, PRs não são empilhadas (#31).
- **O Approve é do dono.** É um comentário cuja primeira linha é exatamente `# Owner Approve` (um `#`, um espaço, essa caixa), seguida das palavras do próprio dono. Depois dele, e só depois, o dono move a label de `ready-for-human` para `ready-for-agent`: o gate só aceita uma aplicação de `ready-for-agent` feita pelo dono depois do Approve em vigor. O agente nunca faz nenhum dos dois.
- **Plano publicado aguarda validação.** Quando o agente publica um plano completo numa issue que estava em `needs-triage`, ele troca essa label por `ready-for-human` no mesmo passo. O Approve e a aplicação de `ready-for-agent` continuam exclusivos do dono.
- **Retirar é explícito, e a dúvida bloqueia.** O dono retira o Approve com um comentário cuja primeira linha é exatamente `# Approve retirado`. Qualquer outra primeira linha numa destas formas de título que mencione "approve" (um heading de qualquer nível, uma linha sublinhada com `===` ou `---`, uma linha inteira em negrito, qualquer um deles citado com `>`) nunca conta como Approve e, depois de um Approve, o cancela. Uma frase comum que menciona approve não muda nada.
- **Revisões do plano entram como comentário.** Um plano revisado é um comentário novo cuja primeira linha é exatamente `# Plano`, com o plano inteiro, nunca uma edição do corpo da issue. Ele cancela o Approve: depois do novo Approve, o dono remove `ready-for-agent` e a aplica de novo.
- **O Approve vale para o texto que o dono leu.** Depois dele, editar o corpo da issue, editar qualquer outro comentário (anterior ou posterior ao Approve) ou apagar um comentário revoga o Approve. Editar o próprio comentário de Approve não revoga: são as palavras do dono.
- **A branch é nomeada no plano**, com o nome exato, dentro da seção Plano do plano vigente. Um plano de bug não tem Plano, e nele a seção é Onde será corrigido.
- **Merge por merge commit**, sem squash e sem rebase.
- **Prosa em pt-BR, tokens em inglês**, como o [guia](../README.md#idioma-e-tokens) detalha.

### Desvios da árvore canônica

| Desvio | Motivo |
| --- | --- |
| As decisões têm quatro dígitos, `NNNN-<slug>.md` | É a forma do lite-campaign. Quem trabalha no mock e no consumidor cita decisões do mesmo jeito |
| Os títulos usam dois-pontos (`# Feature: <título>`), e cada arquivo termina com um único bloco Status | Um lugar fixo para o status é fácil de achar, para pessoas e para scripts |
| Os headings de seção estão em pt-BR, e os tokens em inglês | Os artefatos são em pt-BR por decisão do dono. Os tokens ficam em inglês porque scripts os leem |
| `context/README.md` e `decisions/README.md` funcionam como índices | Quem navega pelo GitHub acha o layout e o status de cada decisão sem precisar de um agente |
| `docs/` fica ao lado de `context/` | `context/` guarda o que o trabalho precisa obedecer ou perseguir. `docs/` guarda guias para pessoas (e o Swagger de entrada), que apontam para `context/` em vez de repetir o que está lá |
| O [AGENTS.md](../../AGENTS.md) declara `context/` como a raiz do Context Mesh, acima da regra global do vault | A regra da máquina do dono manda os arquivos para um vault externo, e um agente que lê as duas precisa saber qual vale aqui. A regra global ganhou uma exceção para este projeto (#1) |
| Ainda não existem `context/agents/` nem `evolution/history/` | Nenhum agente de execução reutilizável foi definido e não há registro arquivado. Cada pasta chega com o primeiro arquivo dela, e o `check:context` já conhece as duas: `agents/agent-<nome>.md` com o título `# Agent: <nome>` e o bloco Status, e `evolution/history/` e `evolution/learning-<slug>.md` sem tipo, como os índices |

## Racional

- **Contexto ao lado do código.** Ele é versionado junto, revisado na PR que o muda, e legível em qualquer clone e no CI, onde o gate lê o changelog e o intent pelo git. Um vault numa máquina só não oferece nada disso.
- **Plano e Approve na issue.** Registrar os dois na issue deixa um rastro durável, que o dono lê no GitHub e que o gate consegue conferir. Um plano aceito numa conversa some com a conversa.
- **Uma PR, uma issue.** É a forma literal do pedido do dono. Fechar exatamente uma issue mantém issue, intent, changelog e PR numa relação de um para um, e a partir de uma linha de `main` dá para chegar ao merge, à PR, à issue, ao plano e ao Approve.
- **Sem lane `batch/`.** No lite-campaign, a lane era o único caminho sem issue, e por isso o único que o gate não tinha como conferir (brunohab/lite-campaign#111). Aqui o dono pediu que toda PR tenha issue.
- **Merge commit.** Os commits da branch chegam a `main` como foram feitos. O commit de intent, que vem primeiro, e o commit de Learn continuam visíveis para o gate, e o merge commit carrega o `Closes #N.` no histórico. A auditoria de `main` (#3) lê só a linha do primeiro pai de `main`, onde cada PR mergeada é um merge commit: por ele ela chega à PR, e confere que a PR fecha uma issue deste repositório e que os checks exigidos estavam verdes na head dela. Os commits da branch, que o gate já julgou na PR, ela não julga de novo.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Manter o Context Mesh no vault externo | CI, revisão e outros clones não enxergam o vault, então o contexto não seria revisado junto com o código que descreve |
| Guardar planos em `~/.claude/plans` | Ficam numa máquina só, fora do alcance do dono no GitHub e do gate. É exatamente o plano fora das issues que o dono vetou |
| Uma lane `batch/` para mudanças pequenas, como no lite-campaign | É um caminho sem issue, portanto sem plano nem Approve para conferir, e o dono pediu que toda PR tenha issue |
| Squash merge | Junta a branch num commit só. Perde o commit de intent que vem primeiro e o commit de Learn, que o gate lê na branch e que ficariam fora do histórico de `main` |
| Rebase merge | Mantém os commits, mas perde o merge commit, que carrega o `Closes #N.` e marca onde a branch começa e termina |
| Prosa em inglês | O dono escolheu pt-BR para os artefatos (#1) |

## Consequências

- **Mais fácil**: todo fato tem um lugar revisável. Qualquer clone e o CI leem o mesmo contexto que quem implementa. O caminho de uma linha de `main` até o plano aprovado é rastreável.
- **Mais difícil**: até um erro de digitação precisa de issue, branch e PR. Os commits da branch precisam estar limpos, porque entram em `main` como estão. Cada mudança carrega o próprio Learn na mesma branch, antes de a PR sair de draft.
- Os nove commits anteriores ao loop não têm issue. O registro retroativo deles é a #4.

## Relacionados

- [ADR 0002: Enforcement soft do loop no GitHub Free](0002-soft-enforcement-on-github-free.md), que diz como este loop é imposto sem branch protection
- [Pattern: Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [Pattern: O gate do loop](../knowledge/patterns/loop-gate.md)
- [Feature: Loop issue-first com gate e vínculo PR↔issue](../intent/feature-issue-first-loop.md), a fatia que colocou esta decisão em prática
- A issue de acompanhamento #1, com as decisões do dono e as fatias #2 a #5

## Status

- **Criado**: 2026-09-24 (Fase: Intent), das decisões do dono de 2026-09-24 (#2)
- **Status**: Accepted
- **Atualizado**: 2026-09-24 (Fase: Build), a gramática do Approve ficou exata depois das revisões adversariais: linhas exatas, heading ambíguo que cancela, label depois do Approve, edições e comentários apagados que revogam, e a branch dentro da seção Plano; a auditoria de `main` passou a ser dita como futura (#2)
- **Atualizado**: 2026-09-24 (Fase: Build), depois da verificação das correções: todo título que o GitHub mostra e que menciona approve cancela o Approve, uma frase comum não, e editar qualquer comentário depois do Approve, não só um anterior a ele, o revoga (#2)
- **Atualizado**: 2026-09-25 (Fase: Build), o Racional e as Alternativas passaram a dizer o que a auditoria de `main` lê de fato, os commits do primeiro pai de `main`, e não a branch: pelo merge commit ela chega à PR e confere a issue fechada e os checks exigidos verdes; e a linha sobre `context/agents/` e `evolution/history/` passou a dizer que o `check:context` já aceita as duas pastas (#3)
- **Atualizado**: 2026-09-25 (Fase: Build), o dono determinou que o agente move `needs-triage` para `ready-for-human` ao publicar um plano, mantendo o Approve e `ready-for-agent` exclusivos do dono (#17)
- **Atualizado**: 2026-09-27 (Fase: Build), uma mudança grande pode vir numa stack de PRs, com cada fatia numa sub-issue da mãe e o Approve da mãe valendo para ela; fora de uma stack declarada, as PRs continuam não empilhadas (#31)
