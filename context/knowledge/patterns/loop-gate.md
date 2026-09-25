# Pattern: O gate do loop

## Resumo

Um comando diz, antes de começar e antes da PR, quais passos do loop estão feitos, quais faltam e se o Build pode começar. Ele recusa no que precisa valer, relata o resto e imprime, em toda execução, a regra que nenhum script consegue impor.

## Problema

O [fluxo de desenvolvimento](../../../docs/development/workflow.md) tem nove passos, e cada um é uma regra que alguém precisa lembrar. Prosa não recusa nada.

No lite-campaign, na brunohab/lite-campaign#100, dois passos foram pulados numa sentada só. A issue saiu com cerca de um terço da profundidade das anteriores. O Approve foi escrito pelo agente a partir de respostas dadas numa conversa, a label foi movida, e sete commits foram construídos antes de o dono ler o plano. Nada pegou. Quem notou foi o dono.

O gate de lá nasceu disso (brunohab/lite-campaign#101) e tem três defeitos conhecidos, corrigidos aqui (abaixo). Duas revisões adversariais do plano da #2 acharam outros buracos, também tratados aqui: uma retirada de Approve lida como Approve, o plano editado depois do Approve, um Approve escrito por bot, um CI que a própria PR conseguia afrouxar, e a detecção de edição por `updatedAt`. Três revisões adversariais da implementação acharam mais: linhas de Approve e de plano aceitas com folga, uma retirada com uma letra diferente ignorada, a label aceita antes do Approve, comentários editados ou apagados depois do Approve, a branch citada fora da seção Plano, e o `stacked` aberto logo depois do corte. A verificação das correções achou o resto: a isenção do `stacked` aberta quando a branch de origem anda depois do corte, um merge com código próprio antes do intent, um merge que esconde uma branch empilhada cuja ref já foi apagada, títulos em formas que o gate não lia, um comentário posterior ao Approve editado para trazer de volta um Approve cancelado, `### Plano de testes` lido como a seção Plano, uma branch de origem que traz esta de volta por merge, e um merge `-s ours` que apagaria o que o `origin/main` ganhou. Tudo isso está fechado nas regras abaixo.

## Solução

### Rodar antes de começar e antes da PR

- `npm run gate` (`node scripts/gate.mjs`) deriva a issue do nome da branch, lê a issue por `gh api graphql` e lê o resto do git.
- As regras vêm de [scripts/loop-sections.mjs](../../../scripts/loop-sections.mjs), a fonte única dos contratos do loop. O gate, o CI, os forms, o `check:context`, a auditoria de `main`, o refresh do `issue-link` e os testes importam de lá, porque uma regra copiada para um segundo lugar diverge: foi assim que o gate do lite-campaign recusou uma branch `fix/` que o próprio pattern de lá permitia (brunohab/lite-campaign#111). A categoria que um prefixo exige também mora lá (`branchCategory`).
- A saída mostra um passo por linha, com `[x]` (ok), `[ ]` (não), `[?]` (não conferido) ou `[-]` (não se aplica). Depois vem "Build BLOQUEADO na #N:" com os motivos, ou "O gate está aberto para a #N.", e sempre a regra do dono.
- Com `--json`, o stdout leva só o objeto de resultado, para scripts, e o relatório para pessoas vai para o stderr. `--no-cache` não escreve o cache.
- Código de saída: 0 quando o gate está aberto (ou em `main`, onde não há nada a julgar), 1 quando está bloqueado ou a branch não é julgável, 2 para erro de uso.
- Em HEAD destacado, ou numa branch que não nomeia uma issue (inclusive `claude/*`), o gate recusa com os formatos aceitos e sem chamar o `gh`: não existe lane sem issue.

### O que bloqueia e o que só relata

Os passos, na ordem em que o gate os imprime:

| Passo | O que confere | Bloqueia |
| --- | --- | --- |
| `repo` | Existe um toplevel git. No modo local, é o repositório onde o próprio script mora, com `AGENTS.md` na raiz. No CI, o remote `origin` é o `GITHUB_REPOSITORY` | Sempre |
| `pr-base` | A PR aponta para `main` | No CI |
| `pr-closes` | A PR fecha a #N deste repositório | No CI |
| `pr-closes-only` | A PR fecha exatamente uma issue | No CI |
| `pr-first-line` | A primeira linha não vazia do corpo da PR é `Closes #N.` | No CI |
| `issue-open` | A issue existe e está aberta | Sempre |
| `kind` | Exatamente uma label de categoria, `bug` ou `enhancement` | Sempre |
| `state-label` | Exatamente uma label de estado, e ela é `ready-for-agent`. As contradições são listadas | Sempre |
| `sections` | O plano vigente tem todas as seções que o tipo da issue exige, e nenhuma vazia | Sempre |
| `criteria` | Os critérios de aceite têm pelo menos um item de checklist | Sempre |
| `approve` | Um Approve do dono está de pé, nada o revogou, e o dono aplicou `ready-for-agent` depois dele (gramática abaixo) | Sempre |
| `branch` | A branch tem um formato aceito, e a issue tem a categoria que o prefixo exige (`fix/` só com a label `bug`). No CI, é a head da PR, e o HEAD é o `headRefOid` da PR | Sempre |
| `branch-in-plan` | A seção Plano do plano vigente (num bug, a seção Onde será corrigido) cita o nome exato da branch | Sempre |
| `stacked` | Nenhuma ref estranha compartilha história não publicada com o HEAD, e nenhum merge da branch traz commits de fora do `origin/main` (abaixo) | Sempre |
| `size` | O tamanho do plano, em caracteres | Nunca |
| `up-to-date` | A branch contém o `origin/main` atual | Nunca |
| `intent-first` | O primeiro commit próprio toca só `context/intent/`, e todo merge antes dele é um merge limpo do `origin/main` (abaixo) | No CI, fora de draft |
| `learn` | Esta branch criou um heading de entrada do changelog citando `(#N)` | No CI, fora de draft |
| `commits-cite-issue` | Todo commit próprio cita `#N` | Nunca |
| `worktree-clean` | A árvore de trabalho está limpa | Nunca (só no modo local) |
| `pushed` | `origin/<branch>` existe e é igual ao HEAD | Nunca (só no modo local) |

O tamanho é relatado, não cobrado. Uma issue curta para uma mudança pequena está certa, e falhar por contagem ensina a encher linguiça. O passo `sections` também não pega um plano raso que tem todos os headings. Quem pega isso é o dono, lendo, com o tamanho ao lado.

### Três defeitos do lite-campaign, corrigidos

- **Learn por menção (brunohab/lite-campaign#124).** Lá, qualquer `#N` no changelog marcava o Learn. Aqui, o passo `learn` exige uma linha que case com o heading de entrada (`## AAAA-MM-DD: <o que mudou> (#N)`, com `, PR #P` opcional) em `git show HEAD:context/evolution/changelog.md`, e que **não** existia no changelog do merge-base entre o HEAD e o `origin/main`. Uma menção no corpo de outra entrada não conta, e uma entrada herdada de `main` também não.
- **Branches empilhadas (brunohab/lite-campaign#122).** Lá, uma branch cortada de outra passava, e o `intent-first` lia o primeiro commit da branch de baixo. Aqui, os passos `stacked` e `intent-first` (abaixo) fecham os dois lados.
- **Duas labels de estado (brunohab/lite-campaign#103).** Lá, duas labels de estado ao mesmo tempo abriam o gate, e o `gh` falso dos testes aceitava qualquer chamada. Aqui, o passo `state-label` exige exatamente uma label de estado, e ela precisa ser `ready-for-agent`. O `gh` falso dos testes é estrito: uma chamada que o caso não espera faz o teste falhar.

### O passo `stacked`

- **Ref estranha** é toda ref em `refs/heads` e `refs/remotes`, menos as da mesma issue (a própria branch e a cópia publicada dela), `refs/remotes/origin/main` e os `*/HEAD`. Uma ref que já está em `origin/main` não conta.
- **Só duas isenções.** Uma ref estranha fica de fora apenas quando:
  - (a) ela é uma branch de issue (`feature/…` ou `fix/…`) estritamente à frente do HEAD, isto é, contém o HEAD e não aponta para ele, **e** todo commit próprio do HEAD (os que o `origin/main` não tem, merges à parte) cita `#N` da issue desta branch. Ela foi construída em cima desta, e é o gate dela que a recusa. Sem isso, "contém o HEAD" também descreve a branch de onde esta foi cortada, depois que ela anda ou traz esta de volta por merge, e os commits dela abaixo do corte viriam junto. Por isso, logo depois do corte, ou enquanto o HEAD carregar um commit que não cita `#N`, a isenção (a) não vale;
  - (b) todo commit que o merge-base dela com o HEAD tem e o `origin/main` não tem cita `#N` da issue desta branch. Ela foi construída sobre commits desta branch que ficaram para trás. Logo depois do corte, antes de um commit que cite `#N`, esta é a única isenção que pode valer, e ela vale para qualquer ref, `main` e `claude/*` inclusive.
- **O teste.** Toda outra ref estranha compartilha história quando o merge-base dela com o HEAD não está em `origin/main`. Isso vale para `main`, para qualquer `claude/*` e para qualquer ref que aponte exatamente para o HEAD. Qualquer ref assim bloqueia, e todas são listadas.
- **Um merge que esconde uma branch.** Um merge em qualquer ponto da linha de primeiro pai da branch, fora do `origin/main`, cujo outro pai não está no `origin/main`, também faz o `stacked` dar não, e o gate cita o merge. Um `git merge --no-ff <outra>` seguido de `git branch -D <outra>` traria a outra branch sem deixar ref nenhuma para o teste acima. Trazer o `origin/main` com um merge continua permitido. Um merge da cópia publicada da própria branch (um `git pull` que cria merge) também conta como merge de fora: traga a cópia publicada com `git pull --ff-only` ou `git pull --rebase`; nesse caso a mensagem do gate aponta o rebase.
- **No terminal**, logo depois do corte e antes do primeiro commit, isso recusa uma branch cortada de um `main` local à frente do `origin/main`, de um `claude/*` ou de outra branch de issue, mesmo que ela ande depois do corte. A exceção é a isenção (b): quando todo commit não publicado que veio junto cita `#N` desta issue, o `stacked` deixa passar, e quem julga esses commits é o `intent-first` no CI.
- **No CI só existem as refs publicadas.** O checkout da PR traz as branches de `origin`, não as refs locais de quem abriu a PR. Uma branch cortada de um `claude/*` não publicado ou de um `main` local passa pelo teste de refs no CI. Quem a pega lá é o `intent-first`, que passa a ler como primeiro commit próprio o primeiro commit não publicado que veio junto, e só fora de draft. Um merge que trouxe outra branch não depende de ref: o `stacked` o vê no histórico, no CI também.

### O passo `intent-first`

- Os **commits próprios** da branch são os de primeiro pai a partir do HEAD que não estão em `origin/main` nem nas refs que o `stacked` apontou, do mais antigo para o mais novo. Numa branch empilhada, o `intent-first` nunca lê o primeiro commit da branch de baixo.
- Merge commits são pulados, então trazer o `origin/main` para dentro da branch com um merge continua permitido.
- Antes do primeiro commit próprio só pode haver merges limpos do `origin/main`: a árvore do merge é igual à árvore de um pai que o `origin/main` contém e que contém todos os outros pais. Por isso um `git merge -s ours origin/main`, que guarda a árvore da base antiga e apagaria o que o `origin/main` ganhou, também é recusado. Um merge com conteúdo próprio faz o `intent-first` dar não ("merge com conteúdo próprio antes do intent"). É o caso de um `git merge --no-ff <outra>` e de um merge do `origin/main` emendado com `git commit --amend` para levar código. Os dois poriam código antes do intent sem que nenhum commit próprio o mostrasse.
- Os caminhos que o primeiro commit toca e as mensagens dos commits são lidos separados por NUL. Um nome de intent com acento (`feature-migração.md`) é lido como está, e nenhum byte numa mensagem de commit quebra a leitura.

### Falhas do `gh`

| Classe | Como é reconhecida | Modo local | CI |
| --- | --- | --- | --- |
| `missing` | O GraphQL responde `NOT_FOUND`, ou o erro diz "could not resolve", "not found" ou HTTP 404 | Bloqueia | Bloqueia |
| `unverified` | Credencial recusada (auth, token, HTTP 401 ou 403, "bad credentials") ou `gh` ausente | Bloqueia | Bloqueia |
| `unreachable` | Qualquer outra falha, como a rede | Os passos da issue viram "não conferido" e não bloqueiam | Bloqueia |

"Essa issue não existe" é uma resposta, e bloqueia. Uma credencial recusada quer dizer que nada foi conferido, e também bloqueia. Só a rede perdida degrada, e só no terminal, porque um gate que não roda sem rede é um gate que as pessoas contornam. No CI, tudo que não foi conferido bloqueia.

### Modo CI

- O workflow `issue-link` roda em `pull_request_target`. O YAML e o gate vêm de `main`, e o gate é chamado por caminho absoluto: `node "$GITHUB_WORKSPACE/trusted/scripts/gate.mjs" --pr <n> --branch <headRef>`, com o diretório atual num checkout da head da PR.
- A PR entra só como dados. Nada dela é instalado nem executado, e os arquivos dela são lidos por `git show <sha>:<caminho>`, nunca pelo sistema de arquivos.
- O modo CI falha fechado, acrescenta os passos da PR, pula `worktree-clean` e `pushed`, e nunca escreve o cache.
- Só as refs publicadas existem no checkout do CI, e o teste de refs do `stacked` só enxerga essas. Os merges, o `stacked` lê no histórico (acima).
- O gate vem de `main` para que uma PR não consiga afrouxar o `issue-link`. O preço: uma PR que corrige o gate é julgada pelo gate antigo até ser mergeada. O `check.yml` roda em `pull_request`, com o YAML da própria PR, e não tem essa proteção ([ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)).
- O `issue-link` só roda com eventos da PR. O Approve retirado, um `# Plano` novo, a label movida ou uma reabertura acontecem na issue. Desde a #3, o workflow `Atualiza vínculo com issue` reage a esses eventos e re-executa a run mais recente do `issue-link` de cada PR aberta que fecha a issue, só entre as runs do evento `pull_request_target`, as que rodam o YAML e o gate de `main`. O rerun reusa o SHA de `main` da run original, então julga com o gate que estava em `main` quando a run começou, mas lê a issue de novo. Uma run ainda na fila ou em andamento é consultada a cada 15 s e esperada por até 4 minutos antes do rerun, e o refresh fica vermelho se ela não termina. O refresh ainda não foi provado ao vivo, e vincular a issue pela barra lateral da PR não dispara nada. Por isso o merge continua exigindo um veredito fresco logo antes ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)).
- Uma PR de fork fica vermelha, de propósito: o checkout recusa a head de um fork.

### O cache

- No modo local, o gate escreve `loop-gate.json` em `$(git rev-parse --absolute-git-dir)`, com `schema`, `repo`, `branch`, `issue`, `headSha`, `open`, `verified`, `steps` e `checkedAt`. Cada worktree tem o próprio diretório git, então cada um tem o próprio cache.
- Só o `scripts/gate.mjs` escreve nele. Os hooks do Claude Code ainda não existem. Quando chegarem com a #5, vão lê-lo pela função `gateStatus()` de `loop-sections.mjs`: o cache só vale para a mesma branch e a mesma issue, por um prazo limitado, e só abre quando a issue foi conferida de fato (`verified`).
- Em `main`, o gate diz que nada está sendo construído, avisa se o `main` local está à frente do `origin/main`, escreve o cache com `open: false` e sai com 0.

### O plano vigente

- O plano vigente é o último comentário cuja primeira linha não vazia, sem os espaços das pontas, é exatamente `# Plano`. O plano é o texto abaixo dessa linha. Se não houver nenhum, vale o corpo da issue.
- `## Plano`, `# plano` ou `# Plano revisado` não são revisão: o gate os lê como comentários comuns, e o plano vigente não muda.
- Por isso, um `# Plano` de revisão traz o plano inteiro, com todas as seções exigidas, e não só o que mudou.
- Os passos `sections`, `criteria` e `branch-in-plan` leem o plano vigente. Em cada seção exigida, um heading igual ao nome (ou a um nome alternativo) vence um que só começa com ele: com `### Plano de testes` antes de `### Plano`, a seção Plano é a segunda. Sem nenhum heading igual, vale o primeiro que começa com o nome, como `Riscos: HIGH`.
- O `branch-in-plan` procura o nome da branch só no conteúdo da seção Plano. Um plano de bug não tem Plano, e nele a seção é Onde será corrigido. Uma branch citada em "Estado atual" ou em "Fora de escopo" não conta, e um nome mais longo que começa com o da branch também não. A lista de seções está no [fluxo de desenvolvimento](../../../docs/development/workflow.md#seções-que-uma-issue-precisa-ter).

### A gramática do Approve

O gate lê a primeira linha não vazia de cada comentário, sem os espaços das pontas, do comentário mais antigo para o mais novo.

- **O Approve.** A primeira linha é exatamente `# Owner Approve`: um `#`, um espaço, essa caixa, e nada mais na linha. Abaixo vêm as palavras do próprio dono. Um Approve sem palavras não conta. Com mais de um Approve, vale o último que está de pé.
- **O autor.** Precisa ser o dono do repositório, como `User`. Um bot ou o token do Actions não contam.
- **A retirada.** Um comentário cuja primeira linha é exatamente `# Approve retirado` retira o Approve que estava de pé.
- **Na dúvida, bloqueia.** Qualquer outra primeira linha numa destas formas de título que mencione "approve", em qualquer caixa, nunca conta como Approve. As formas:
  - um heading de `#` a `######`, com os `#` seguidos de espaço ou de letra. `#Owner Approve` conta como quase-Approve de propósito, mesmo que o GitHub o mostre como parágrafo; `#5 aguarda o Approve` é uma referência a issue;
  - uma primeira linha sublinhada com `===` ou `---` na linha logo abaixo (heading setext);
  - uma primeira linha inteira em negrito, `**…**` ou `__…__`;
  - qualquer um desses citado com `>`, como `> # Approve retirado`.

  Outras formas que o GitHub também mostra como título, como `<h1>` em HTML ou um título dentro de um item de lista (`- # …`), não são lidas: são um limite conhecido, e quem escreve Approve e retirada usa as linhas exatas.

  Depois de um Approve, um comentário que abre com um título desses cancela o Approve, e o gate cita a linha. Assim `## Owner Approve`, `# owner approve`, `# Approve retirado.`, `##### Approve retirado`, `**Approve retirado**` e até `# Perguntas para o Approve` cancelam, em vez de passar em silêncio. Uma frase comum que menciona approve, como `Approve retirado` sem marcação, não é título e não muda nada. Uma resposta que não quer mexer no Approve não abre com um título que fala de approve. O [fluxo](../../../docs/development/workflow.md#comentários-que-o-gate-lê) tem uma tabela de exemplos que um teste confere contra o gate.
- **A revisão.** Um novo comentário `# Plano` depois do Approve o cancela, de propósito: o dono aprova um plano, não uma issue.
- **O texto que o dono leu.** Depois do Approve, o gate bloqueia quando:
  - o corpo da issue foi editado;
  - qualquer outro comentário foi editado depois do Approve, seja ele anterior ou posterior ao Approve (um `# Plano`, uma retirada, uma resposta, qualquer um);
  - um comentário foi apagado.

  O próprio Approve fica de fora: editar as palavras dele é direito do dono e não bloqueia. Um comentário posterior conta porque editar uma retirada ou um `# Plano` para tirar o título traria de volta o Approve que eles tinham cancelado, sem nenhum ato novo do dono. A edição é medida pelo `lastEditedAt`, nunca pelo `updatedAt`, que muda a cada label ou comentário. Marcar um checkbox no corpo é uma edição: os critérios são marcados só em `context/intent/`.
- **A label.** Conta a última aplicação de `ready-for-agent`. Ela precisa ter sido feita pelo dono, como `User`, depois da última reabertura e depois do Approve em vigor. Se foi de outro ator, veio antes do Approve, ou não há evento nenhum, o gate bloqueia. Depois de uma revisão e de um novo Approve, o dono remove a label e a aplica de novo, mesmo que ela nunca tenha saído da issue.
- **A reabertura.** Reabrir a issue zera tudo: um Approve ou uma label anteriores à última reabertura não contam.
- **O limite de leitura.** Com mais de 100 comentários ou mais de 100 eventos na issue, o passo `approve` bloqueia e explica: o gate se recusa a julgar o que não conseguiu ler inteiro.

### O que ele não consegue fazer

Este repositório tem uma conta só no GitHub. O dono e o agente postam com o mesmo login, então nada nos metadados de uma issue distingue um comentário do dono de um que o agente escreveu com a voz do dono. Nenhum script rodado com essa conta fecha esse buraco. Por isso o gate imprime, em toda execução, inclusive nas que passam:

> O dono move a label e escreve o Approve. O agente nunca faz nenhum dos dois.

- Mover `ready-for-human` para `ready-for-agent` é um ato do dono. É um segundo ato deliberado, e o gate exige que ele venha depois do Approve: é isso que dificulta fabricar um Approve por acidente.
- Um Approve são as palavras do dono. Uma aprovação dada no chat não é Approve, e o agente nunca a transcreve para a issue.
- Até os hooks da #5, só essa regra escrita impede o auto-Approve. Depois que eles chegarem, ela continua valendo fora das sessões do Claude Code deste projeto ([ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)).
- O gate data o Approve pelo `createdAt` dele e não conta as edições do próprio Approve. Um comentário postado antes da label e editado depois para virar `# Owner Approve` parece um Approve antigo seguido da label. Separar os dois exige ler a primeira versão do comentário (`userContentEdits` no GraphQL). Até lá, esse caso também fica com a regra escrita, e os hooks da #5 vão proibir o agente de editar um comentário para virar Approve.

## Quando usar

- Em toda branch de issue, antes do primeiro commit e de novo antes da PR.
- No CI, em toda PR, pelo `issue-link`.
- Logo antes do merge, para o veredito fresco, quando o `issue-link` não pode ser re-rodado.

## Quando NÃO usar

- Para julgar se um plano é bom. O gate confere a forma do loop, não o mérito do plano: isso é a leitura do dono.
- Em `main` e na issue de acompanhamento (#1), que não têm branch de trabalho. Em `main`, o gate só relata e sai com 0.

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../../decisions/0001-context-mesh-in-the-repository.md)
- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)

## Status

- **Criado**: 2026-09-24 (Fase: Build), do gate do lite-campaign (brunohab/lite-campaign#101), dos três defeitos dele e do plano aprovado na #2 (#2)
- **Status**: Active
- **Atualizado**: 2026-09-25 (Fase: Build), o modo CI passou a descrever o refresh do `issue-link` nos eventos da issue, só sobre as runs do `pull_request_target`, a espera por uma run em andamento, o que ele ainda não provou ao vivo e por que o veredito fresco antes do merge continua, e a fonte única passou a listar o `check:context`, a auditoria de `main` e o refresh entre quem importa dela (#3)
