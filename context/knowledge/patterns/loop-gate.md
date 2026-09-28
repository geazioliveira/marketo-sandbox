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
| `pr-base` | A PR aponta para `main` ou, numa fatia de stack, para a fatia logo abaixo com a PR em draft; uma fatia acima da primeira só aponta para `main` depois de as de baixo serem mergeadas ([abaixo](#uma-fatia-de-stack)) | No CI |
| `pr-closes` | A PR fecha a #N deste repositório | No CI |
| `pr-closes-only` | A PR fecha exatamente uma issue | No CI |
| `pr-first-line` | A primeira linha não vazia do corpo da PR é `Closes #N.` | No CI |
| `copilot-review` | Uma revisão do Copilot (`Bot`, `databaseId` 175728472), `COMMENTED` ou `APPROVED`, que não falhou, cujo `commit.oid` é a cabeça da PR (abaixo). Uma que conta entre as 100 mais recentes basta; sem nenhuma entre elas, com mais revisões que isso, fica `[?]`. Com outra revisão do Copilot pedida e ainda a caminho (`copilotRequested`), fica `[ ]` mesmo com uma revisão na cabeça | No CI, fora de draft |
| `review-threads` | Nenhuma thread de revisão não resolvida, de qualquer autor, inclusive as desatualizadas. Lista até 10 como `path:line` e link, e o total. Uma página lida pela metade fica `[?]` | No CI, fora de draft |
| `pr-size` | As linhas alteradas da PR (adições mais remoções) e os arquivos, contra a base. Acima de 1.500 linhas (`prSizeLimit`), fica sem [x], só como aviso | Nunca (só no CI) |
| `issue-open` | A issue existe e está aberta; numa fatia de stack, a mãe também | Sempre |
| `kind` | Exatamente uma label de categoria, `bug` ou `enhancement`. Numa fatia de stack, a mãe também precisa de exatamente uma | Sempre |
| `state-label` | Exatamente uma label de estado, e ela é `ready-for-agent`. As contradições são listadas. Numa fatia de stack, é a da mãe, e a fatia não leva nenhuma | Sempre |
| `sections` | O plano vigente tem todas as seções que o tipo da issue exige, e nenhuma vazia. Numa fatia de stack, o plano é o da mãe | Sempre |
| `criteria` | Os critérios de aceite têm pelo menos um item de checklist fora de bloco de código e de comentário HTML | Sempre |
| `approve` | Um Approve do dono está de pé, nada o revogou, e o dono aplicou `ready-for-agent` depois dele (gramática abaixo). Numa fatia de stack, na mãe | Sempre |
| `branch` | A branch tem um formato aceito, e a issue tem a categoria que o prefixo exige (`fix/` só com a label `bug`). No CI, é a head da PR, e o HEAD é o `headRefOid` da PR | Sempre |
| `branch-in-plan` | A seção Plano do plano vigente (num bug, a seção Onde será corrigido) cita o nome exato da branch. Numa fatia de stack, a seção `Stack` do plano vigente da mãe | Sempre |
| `stacked` | Nenhuma ref estranha compartilha história não publicada com o HEAD, e nenhum merge da branch traz commits de fora do `origin/main` (abaixo) | Sempre |
| `size` | O tamanho do plano, em caracteres | Nunca |
| `up-to-date` | A branch contém o `origin/main` atual | Nunca |
| `intent-first` | O primeiro commit próprio toca só `context/intent/`, e todo merge antes dele é um merge limpo do `origin/main` (abaixo) | No CI, fora de draft; numa stack, só na primeira fatia |
| `learn` | Esta branch criou um heading de entrada do changelog citando `(#N)`; numa stack, citando a mãe | No CI, fora de draft; numa stack, só na última fatia |
| `commits-cite-issue` | Todo commit próprio cita `#N` | Numa fatia acima da primeira, no CI fora de draft; nas outras branches, nunca |
| `worktree-clean` | A árvore de trabalho está limpa | Nunca (só no modo local) |
| `pushed` | `origin/<branch>` existe e é igual ao HEAD | Nunca (só no modo local) |

O tamanho é relatado, não cobrado. Uma issue curta para uma mudança pequena está certa, e falhar por contagem ensina a encher linguiça. O passo `sections` também não pega um plano raso que tem todos os headings. Quem pega isso é o dono, lendo, com o tamanho ao lado.

### Três defeitos do lite-campaign, corrigidos

- **Learn por menção (brunohab/lite-campaign#124).** Lá, qualquer `#N` no changelog marcava o Learn. Aqui, o passo `learn` exige uma linha que case com o heading de entrada (`## AAAA-MM-DD: <o que mudou> (#N)`, com `, PR #P` opcional) em `git show HEAD:context/evolution/changelog.md`, e que **não** existia no changelog do merge-base entre o HEAD e o `origin/main`. Uma menção no corpo de outra entrada não conta, e uma entrada herdada de `main` também não.
- **Branches empilhadas (brunohab/lite-campaign#122).** Lá, uma branch cortada de outra passava, e o `intent-first` lia o primeiro commit da branch de baixo. Aqui, os passos `stacked` e `intent-first` (abaixo) fecham os dois lados.
- **Duas labels de estado (brunohab/lite-campaign#103).** Lá, duas labels de estado ao mesmo tempo abriam o gate, e o `gh` falso dos testes aceitava qualquer chamada. Aqui, o passo `state-label` exige exatamente uma label de estado, e ela precisa ser `ready-for-agent`. O `gh` falso dos testes é estrito: uma chamada que o caso não espera faz o teste falhar.

### O passo `stacked`

- **Ref estranha** é toda ref em `refs/heads` e `refs/remotes`, menos a própria branch (`refs/heads/<branch>`), a cópia dela em `origin` (`refs/remotes/origin/<branch>`, a mesma que o passo `pushed` lê), `refs/remotes/origin/main` e os `*/HEAD`. Só o nome exato da branch fica de fora, e só nesses dois lugares: uma ref de mesmo nome em outro remote é a cópia de outra pessoa, e é estranha. Uma ref que já está em `origin/main` não conta.
- **Só duas isenções.** Uma ref estranha fica de fora apenas quando:
  - (a) ela é uma branch de outra issue (`feature/…` ou `fix/…`) estritamente à frente do HEAD, isto é, contém o HEAD e não aponta para ele, **e** todo commit próprio do HEAD (os que o `origin/main` não tem, merges à parte) cita `#N` da issue desta branch. Ela foi construída em cima desta, e é o gate dela que a recusa. Sem isso, "contém o HEAD" também descreve a branch de onde esta foi cortada, depois que ela anda ou traz esta de volta por merge, e os commits dela abaixo do corte viriam junto. Por isso, logo depois do corte, ou enquanto o HEAD carregar um commit que não cita `#N`, a isenção (a) não vale;
  - (b) todo commit que o merge-base dela com o HEAD tem e o `origin/main` não tem cita `#N` da issue desta branch. Ela foi construída sobre commits desta branch que ficaram para trás. Logo depois do corte, antes de um commit que cite `#N`, esta é a única isenção que pode valer, e ela vale para qualquer ref que não nomeie a #N, `main` e `claude/*` inclusive.
- **Outra branch da mesma issue.** Nenhuma das duas isenções vale para uma ref cujo nome nomeia a #N (`feature/N-…` ou `fix/N-…`) e que não é a própria branch nem a cópia dela em `origin`: os commits dos dois lados citam `#N`, e o git não diz qual branch foi cortada de qual. Isso pega uma branch cortada de outra da #N, a branch de onde ela foi cortada e uma sobra com o nome antigo (`git branch -m` depois de um push). Se ela compartilha história não publicada com o HEAD, o `stacked` bloqueia, porque uma issue tem uma branch só. Numa ref de outro remote, que o `git branch -d` não alcança, a mensagem dá o remédio geral de cortar a branch de novo. Em `refs/heads` e em `origin`, o remédio depende da direção:
  - se o HEAD já contém a outra branch (ela não tem nada que o HEAD não tenha), apague-a. A mensagem cita só os comandos das refs que o gate achou: `git branch -d <nome>` para a branch local e `git push origin --delete <nome>` para a cópia em `origin`. Uma sobra com o nome antigo depois de `git branch -m` e de um push só existe em `origin`, e a mensagem não cita o `git branch -d`, que falharia nela. Se ela já não existe no GitHub e só sobrou o `origin/<nome>` local, em que o `git push --delete` falha, é `git fetch --prune origin`;
  - se a outra branch tem commits que o HEAD não tem, fique com uma só: traga para ela o trabalho da outra, e só então apague a outra. O `git branch -d` recusa apagar trabalho não mergeado, e o gate nunca sugere `git branch -D`.
- **O teste.** Toda outra ref estranha compartilha história quando o merge-base dela com o HEAD não está em `origin/main`. Isso vale para `main`, para qualquer `claude/*` e para qualquer ref que aponte exatamente para o HEAD. Qualquer ref assim bloqueia, e todas são listadas. Uma ref sem commit em comum com o HEAD (o `git merge-base` sai com 1, sem imprimir nada) não compartilha nada. Uma que o git não consegue comparar com o HEAD (qualquer outra falha, como um objeto danificado ou uma história rasa) bloqueia, e o gate diz que não conseguiu compará-la: uma falha não prova que as histórias não se tocam.
- **Um merge que esconde uma branch.** Um merge em qualquer ponto da linha de primeiro pai da branch, fora do `origin/main`, cujo outro pai não está no `origin/main`, também faz o `stacked` dar não, e o gate cita o merge. Um `git merge --no-ff <outra>` seguido de `git branch -D <outra>` traria a outra branch sem deixar ref nenhuma para o teste acima. Trazer o `origin/main` com um merge continua permitido. Um merge da cópia publicada da própria branch (um `git pull` que cria merge) também conta como merge de fora: traga a cópia publicada com `git pull --ff-only` ou `git pull --rebase`; nesse caso a mensagem do gate aponta o rebase.
- **No terminal**, logo depois do corte e antes do primeiro commit, isso recusa uma branch cortada de um `main` local à frente do `origin/main`, de um `claude/*` ou de outra branch de issue, mesmo que ela ande depois do corte. A exceção é a isenção (b): quando todo commit não publicado que veio junto cita `#N` desta issue e a ref de origem não é outra branch da #N, o `stacked` deixa passar, e quem julga esses commits é o `intent-first` no CI.
- **No CI só existem as refs publicadas.** O checkout da PR traz as branches de `origin`, não as refs locais de quem abriu a PR. Uma branch cortada de um `claude/*` não publicado ou de um `main` local passa pelo teste de refs no CI. Quem a pega lá é o `intent-first`, que passa a ler como primeiro commit próprio o primeiro commit não publicado que veio junto, e só fora de draft. Um merge que trouxe outra branch não depende de ref: o `stacked` o vê no histórico, no CI também.

- **Numa fatia de stack**, as refs das fatias de baixo e de cima da mesma `Stack`, locais ou em `origin`, não são estranhas, e um merge de uma fatia de baixo não é merge de fora ([Uma fatia de stack](#uma-fatia-de-stack)).

### Uma fatia de stack

Uma mudança grande vem numa stack de PRs, e cada fatia é uma sub-issue da issue mãe (#31).

- **Quando o gate lê a mãe.** Só para uma issue que leva a label `stack-slice` (`stackSliceLabel`). A consulta da issue traz o `parent`, com o número e o repositório, e a mãe é lida com a mesma consulta. Uma mãe de outro repositório é recusada: uma stack fica num repositório só. Uma sub-issue sem a label, como as filhas da #1, é julgada pelo próprio plano, como sempre, e a mãe dela nem é lida. Uma mãe que não se lê, por qualquer falha do `gh`, ou uma resposta que não diz o repositório dela deixam o veredito não verificado, como uma issue que não se lê: o cache fica `verified: false` e, com o GitHub inacessível, o relatório avisa no modo local.
- **O que vem de cada uma.** Da fatia vêm a categoria (`kind`) e o `issue-open`, que também exige a mãe aberta. Da mãe vêm a label de estado, as seções, os critérios, o Approve e o tamanho do plano. O `kind` também exige exatamente uma label de categoria na mãe, porque é a categoria dela que diz quais seções o plano precisa ter. Bloqueiam uma fatia que leva uma label de estado, uma fatia que não é sub-issue de nenhuma issue e uma mãe que também leva `stack-slice`: uma stack não se aninha, e a mãe de uma fatia é a raiz da stack.
- **A `Stack`.** É a seção do plano vigente da mãe com o título exato `Stack`, uma só, em qualquer nível de título (`stackOf`): `## Stack` num plano em comentário, e `###` ou `####` num plano vindo do form, cujos campos são `###`. A lista são os itens numerados na primeira coluna, até o primeiro subtítulo, fora de bloco de código e de comentário HTML, e cada um começa com a branch da fatia num code span, de uma crase ou de mais, como o CommonMark lê. Um bullet, um item indentado ou um parágrafo é prosa: uma nota que cita uma branch nunca vira fatia. Toda branch da `Stack` é de uma fatia da mãe: uma sub-issue dela, deste repositório, com `stack-slice`. Senão, uma branch de fora passaria por fatia de baixo, aceita como base e tirada dos commits próprios, ou por fatia de cima, isenta no `stacked`. A consulta da issue traz as sub-issues com o repositório e as labels de cada uma, e uma página lida pela metade deixa a `Stack` sem julgar. Bloqueiam: um item numerado que não começa com uma branch, um item com duas branches, uma branch citada duas vezes, duas branches da mesma issue, a branch da própria mãe, a branch de uma issue que não é fatia da mãe e uma seção sem nenhuma. A ordem é de baixo para cima e dá a posição da fatia (`slicePosition`). O `branch-in-plan` exige a branch na `Stack`.
- **A base da PR.** O `pr-base` aceita a fatia logo abaixo só com a PR em draft: uma PR em draft não se mergeia, então nenhuma fatia é mergeada dentro de outra. Aceita `main` na primeira fatia e, nas outras, só depois de toda fatia de baixo ser mergeada: a ref dela, se existir, está no `origin/main`, e a sub-issue dela está fechada, como a PR a deixa no merge. Uma ref ausente (nunca publicada, ou apagada sem merge) ou ainda em `main` (publicada antes do primeiro commit) não prova nada. Antes disso, o merge desta levaria as de baixo junto, ou as pularia, sem o gate delas.
- **O vínculo da PR.** O GitHub só liga as palavras de fechamento numa PR para a branch padrão. A PR de uma fatia com base na fatia de baixo ainda não tem vínculo, e o `pr-closes` e o `pr-closes-only` leem o corpo dela (`closingRefsOf`): as palavras de fechamento fora de comentário HTML, com o código incluído, do lado que bloqueia. Com a base em `main`, vale o vínculo do GitHub, que não aparece sozinho quando a base muda: na stack da #5, o GitHub mudou a base da PR de cima para `main` no merge da de baixo sem ligá-la à sub-issue. Se o vínculo falta e o corpo fecha a issue, a mensagem manda editar o corpo da PR, e a edição cria o vínculo na hora.
- **O `stacked`.** Para uma fatia, as fatias de baixo fazem o papel do `origin/main`:
  - as refs delas ficam fora do teste e fora dos commits próprios, e um merge cujo outro pai está numa delas é a atualização da fatia, não um merge de fora;
  - uma ref que divide com o HEAD só o histórico delas, como uma branch cortada de uma fatia de baixo, não divide nada desta fatia e não é estranha;
  - nas isenções gerais, os commits delas não contam como da ref, e só os desta fatia precisam citar a #N.

  A ref de uma fatia de cima fica fora do teste quando foi cortada desta: ela divide com o HEAD commits desta fatia, além do `origin/main` e das fatias de baixo, e nenhum deles cita a sub-issue de uma fatia de cima. Um fast-forward desta fatia para a de cima traz commits que citam a sub-issue dela, e um merge da de cima nesta é um merge de fora. O que os commits desta fatia citam não importa aqui: um commit sem número, como uma sugestão aplicada no GitHub, só é relatado pelo `commits-cite-issue`. Uma ref de cima que não passa é estranha, e o gate diz que a de cima traz esta, nunca o contrário. Numa fatia acima da primeira, o conserto de recorte manda cortar de novo a partir da fatia logo abaixo, e não de `main`. Só contam as refs deste repositório, locais ou em `origin`, e qualquer outra ref continua estranha. Um `git rev-list --first-parent` que falha bloqueia o `stacked`, como um `git merge-base` que falha.
- **Os atos da fatia.** Uma fatia não tem Approve, mas os atos dela contam contra o da mãe, como numa issue qualquer. A reabertura dela zera o Approve, e vale para ela um Approve novo na mãe, com `ready-for-agent` aplicada de novo. Também contam uma retirada, uma revisão ou um título com Approve postados nela, e um comentário dela editado ou apagado depois do Approve. As labels dela e um Approve escrito nela não contam.
- **O intent, o Learn e os commits.** O `intent-first` bloqueia só na primeira fatia, e o `learn` só na última, com um heading do changelog que cita a mãe. Nas outras, os dois só relatam, e o relatório diz em que fatia cada um vai. Acima da primeira fatia, o `intent-first` já não pega uma branch cortada de trabalho de fora da stack, então ali o `commits-cite-issue` bloqueia, no CI fora de draft: todo commit próprio cita a sub-issue da fatia.
- **O tamanho.** Numa fatia acima da referência, o `pr-size` sugere dividir a fatia em mais fatias.
- **O refresh.** Um evento na mãe re-executa também o `issue-link` das PRs abertas que fecham as sub-issues com `stack-slice`, porque a fatia é julgada pela mãe. Ele não cobre dois casos, e o veredito fresco antes de sair de draft e antes do merge cobre os dois:
  - uma PR de fatia com base na fatia de baixo, que o GitHub não liga à sub-issue;
  - um evento numa fatia, que não re-roda as fatias irmãs, embora a `Stack` delas dependa dela.

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
- O `issue-link` só roda com eventos da PR. O Approve retirado, um `# Plano` novo, a label movida ou uma reabertura acontecem na issue. Desde a #3, o workflow `Atualiza vínculo com issue` reage a esses eventos e re-executa a run mais recente do `issue-link` de cada PR aberta que fecha a issue, só entre as runs do evento `pull_request_target`, as que rodam o YAML e o gate de `main`. O rerun reusa o SHA de `main` da run original, então julga com o gate que estava em `main` quando a run começou, mas lê a issue de novo. Uma run ainda na fila ou em andamento é consultada a cada 15 s e esperada por até 4 minutos antes do rerun, e o refresh fica vermelho se ela não termina. O refresh ainda não foi provado ao vivo, e vincular a issue pela barra lateral da PR não dispara nada. Por isso o merge continua exigindo um veredito fresco logo antes ([fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)). Desde a #13, o refresh também re-executa o `issue-link` de uma PR depois de uma revisão nela, ou a pedido (abaixo).
- Uma PR de fork fica vermelha, de propósito: o checkout recusa a head de um fork.

### A revisão do Copilot e as threads

Desde a #13, uma PR só é mergeada com uma revisão do Copilot no commit que é a cabeça dela e nenhuma thread de revisão aberta ([ADR 0003](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). O gate confere as duas coisas nos passos `copilot-review` e `review-threads`.

- **Só no modo CI, e só fora de draft.** Só o modo CI lê a PR. No terminal, os dois passos saem `[-]`, com "só no modo CI". Numa PR em draft, que não pode ser mergeada, eles só relatam, como `intent-first` e `learn`. Fora de draft, bloqueiam. Se a PR não existe, os dois ficam `[ ]`, e se ela não pôde ser lida, `[?]`: nos dois casos bloqueiam.
- **`copilot-review`.** O gate lê as 100 revisões mais recentes da PR e as passa pela `copilotReviewOn`, de [scripts/loop-sections.mjs](../../../scripts/loop-sections.mjs). Uma revisão conta quando cumpre três coisas:
  - o autor é `Bot` com `databaseId` 175728472 (`copilotReviewer`);
  - o estado é `COMMENTED` ou `APPROVED` (`copilotReviewStates`);
  - o `commit.oid` é o `headRefOid` da PR.

  O login `copilot-pull-request-reviewer` é só um rótulo: no GitHub, `users/copilot-pull-request-reviewer` é uma organização, e o REST escreve o nome do bot de dois jeitos. Uma revisão de um commit anterior não conta. Uma revisão `DISMISSED`, `PENDING` ou `CHANGES_REQUESTED` também não. Uma revisão que falhou também não: ela chega `COMMENTED`, do bot e na cabeça, e o gate a reconhece pelo começo do corpo (`copilotFailedReview`: "Copilot encountered an error", "Copilot was unable to review" (cota, cobrança ou elegibilidade), "Copilot wasn't able to review" ou "Copilot was not able to review", com qualquer apóstrofo e sem distinguir maiúsculas); uma revisão sem corpo, ou com o corpo vazio ou só com espaços, conta como falha, porque nada nela mostra que o Copilot revisou alguma coisa. A mensagem diz o que falta, sempre com o comando `gh pr edit <n> --add-reviewer @copilot`, e termina com o jeito de renovar o veredito (`node scripts/gate.mjs --pr <n> --branch <branch>`, na cabeça da PR). Cada valor desses comandos passa pela `shellWord`: um valor com um caractere que o shell lê como sintaxe sai entre aspas simples, e colar o comando nunca roda nada além dele (revisão do Copilot na PR #15). O que a mensagem diz, caso a caso:
  - nenhuma revisão do Copilot ainda: ela é pedida sozinha quando a PR sai de draft e leva uns 6 min;
  - a última revisão falhou, e a mensagem cita a primeira linha do corpo dela, ou diz que o GitHub não deu o corpo ou que ele veio vazio;
  - a última revisão cobre outro commit, e a mensagem dá os dois SHAs curtos;
  - a última revisão está num estado que não conta, e a mensagem diz qual.

  Uma revisão do Copilot pedida e ainda a caminho também segura o merge, mesmo com uma revisão na cabeça: as threads da revisão nova ainda não existem, e mergear antes de uma revisão chegar foi o que aconteceu nas PRs #10 e #11. O gate lê os pedidos de revisão da PR (`reviewRequests`, até 100) e os passa pela `copilotRequested`, que casa o revisor como casa o autor de uma revisão: `Bot` com o `databaseId` do Copilot. O GitHub tira o pedido quando a revisão chega, então um pedido pendente é uma revisão a caminho. Nesse caso, a mensagem manda esperar a revisão (uns 6 min) e tratar as threads dela, e só pedir de novo se ela não chegar em uns 10 min. Medido na PR #15: o GraphQL mostra o pedido pendente ao Copilot, e o `requested_reviewers` do REST vem vazio.
- **`review-threads`.** O gate lê as threads de revisão da PR, até 100, e as passa pela `openThreads`. Conta como aberta toda thread não resolvida, de qualquer autor (o Copilot, o dono ou outra pessoa), inclusive as desatualizadas. Uma thread que não diz se está resolvida também conta como aberta. A mensagem dá quantas threads estão abertas e o total, e lista até 10, cada uma como `path:line` (só o `path` quando o GitHub não dá a linha, e com `(desatualizada)` quando ela está desatualizada), com quem a abriu e o link; o resto sai como "e mais N". Ela termina com o jeito de renovar o veredito, como a de `copilot-review`. Com `--json`, a lista vai no detalhe do passo.
- **Uma página lida pela metade.** As revisões vêm das mais recentes (`last: 100`). Uma revisão que conta entre as lidas basta, porque as mais antigas não a desfazem, como na auditoria (`auditReviewPage`); sem nenhuma entre elas, com mais revisões do que o gate leu, o passo fica `[?]` e bloqueia fora de draft. Com mais threads do que o gate leu, ou quando o GitHub não diz quantas revisões ou threads são (`totalCount`), o passo também fica `[?]` e bloqueia fora de draft. Com uma revisão na cabeça, os pedidos de revisão lidos pela metade, ou sem `totalCount`, deixam `copilot-review` em `[?]` quando o pedido ao Copilot não está entre os lidos, porque ele pode estar entre os que faltam. O gate não julga o que não leu.
- **Um achado só no resumo da revisão fica de fora.** Do corpo da revisão, o gate só lê o começo, para reconhecer uma revisão que falhou. O resto do formato não é documentado, e o gate não lê achados ali. O agente trata esse achado na PR ([fluxo](../../../docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)).
- **Como o veredito se renova.** Uma revisão não é evento do `pull_request_target`, e o evento de revisão (`pull_request_review`) roda o YAML da própria PR. Por isso o re-disparo tem duas etapas:
  - o `Sinal de revisão` (`review-signal.yml`) roda nesse evento com `permissions: {}` e só sinaliza;
  - o `Atualiza vínculo com issue` roda de `main` e responde ao `workflow_run` do sinal, só quando a run dele terminou com `success`. Ele lê a PR de novo e re-executa o `issue-link` da cabeça dela.

  Resolver ou reabrir uma thread não dispara workflow nenhum. Depois de resolver, o agente atualiza o check com `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`, que sozinho não é veredito fresco. Logo antes do merge vale o veredito fresco do [fluxo](../../../docs/development/workflow.md#pull-requests-e-merge): o gate em modo CI na cabeça da PR, com saída 0, ou o rerun do `issue-link` acompanhado até o fim com `gh run watch <run-id> --exit-status`.

### O cache

- No modo local, o gate escreve `loop-gate.json` em `$(git rev-parse --absolute-git-dir)`, com `schema`, `repo`, `branch`, `issue`, `headSha`, `open`, `verified`, `steps` e `checkedAt`. Cada worktree tem o próprio diretório git, então cada um tem o próprio cache.
- Só o `scripts/gate.mjs` escreve nele. Os hooks do Claude Code (#5) o leem pela função `gateStatus()` de `loop-sections.mjs`: o cache só vale para a mesma branch e a mesma issue, por um prazo limitado, e só abre quando a issue foi conferida de fato (`verified`).
- Um plano aceito no plan mode e ainda não publicado fecha o cache enquanto o marcador dele existir, por mais recente que seja o gate. Ao publicar o plano, o hook `plan-to-issue` apaga o cache de cada worktree do repositório, para o gate rodar de novo, e só então o marcador: se uma remoção falha, o marcador fica.
- Em `main`, o gate diz que nada está sendo construído, avisa se o `main` local está à frente do `origin/main`, escreve o cache com `open: false` e sai com 0.

### O plano vigente

- O plano vigente é o último comentário cuja primeira linha não vazia, sem os espaços das pontas, é exatamente `# Plano`. O plano é o texto abaixo dessa linha. Se não houver nenhum, vale o corpo da issue.
- `## Plano`, `# plano` ou `# Plano revisado` não são revisão: o gate os lê como comentários comuns, e o plano vigente não muda.
- Por isso, um `# Plano` de revisão traz o plano inteiro, com todas as seções exigidas, e não só o que mudou.
- Os passos `sections`, `criteria` e `branch-in-plan` leem o plano vigente. Em cada seção exigida, um heading igual ao nome (ou a um nome alternativo) vence um que só começa com ele: com `### Plano de testes` antes de `### Plano`, a seção Plano é a segunda. Sem nenhum heading igual, vale o primeiro que começa com o nome, como `Riscos: HIGH`.
- Esses passos leem o plano como o GitHub o mostra. Um heading dentro de um bloco de código ou de um bloco de comentário HTML (`<!-- … -->`) não abre seção, e uma caixa dentro de um deles não é critério: uma seção exigida que só existe comentada falta, e uma caixa que só existe num exemplo não conta.
- O conteúdo de uma seção e a citação da branch também ignoram os comentários HTML, em bloco ou no meio de uma linha: uma seção que só traz `<!-- HIGH ou NORMAL -->` está vazia, e uma branch citada só dentro de um comentário não conta. Um bloco de código é texto visível: ele conta como conteúdo da seção e como citação da branch, só não como critério.
- Os blocos de código seguem o CommonMark: a cerca que fecha é do mesmo caractere da que abriu, pelo menos tão longa quanto ela e sem nada depois, então um ```` ```js ```` dentro de um bloco de três crases é código, e uma cerca deixada aberta vai até o fim. O comentário HTML é um bloco que começa numa linha aberta por `<!--` e vai até a linha que traz `-->`, inteira; um deixado aberto também vai até o fim.
- Um bloco de código dentro de um item de lista costuma vir indentado com quatro espaços ou mais (`1. Exemplo:` e, abaixo, a cerca indentada). Na dúvida, o gate bloqueia: uma cerca com qualquer indentação abre um bloco quando a última linha não vazia antes dela é um item de lista ou a continuação de um, e uma caixa nesse bloco não conta. Fora de uma lista, uma linha indentada com quatro espaços ou mais é código indentado, que o gate não reconhece como código: uma caixa nele ainda conta.
- O `branch-in-plan` procura o nome da branch só no conteúdo da seção Plano. Um plano de bug não tem Plano, e nele a seção é Onde será corrigido. Uma branch citada em "Estado atual" ou em "Fora de escopo" não conta, um nome mais longo que começa com o da branch também não, e um nome que só aparece dentro de um comentário HTML também não. Dentro de um bloco de código ou de um trecho de código, conta. A lista de seções está no [fluxo de desenvolvimento](../../../docs/development/workflow.md#seções-que-uma-issue-precisa-ter).

### A gramática do Approve

O gate lê a primeira linha não vazia de cada comentário, sem os espaços das pontas, do comentário mais antigo para o mais novo.

- **O Approve.** A primeira linha é exatamente `# Owner Approve`: um `#`, um espaço, essa caixa, e nada mais na linha. Abaixo vêm as palavras do próprio dono. Um Approve sem palavras não conta. Com mais de um Approve, vale o último que está de pé.
- **O autor.** Precisa ser o dono do repositório, como `User`. Um bot ou o token do Actions não contam.
  - Só os atos que abrem o gate exigem o dono: o Approve e a aplicação da `ready-for-agent` (abaixo). Um `# Owner Approve` de outro autor não conta como Approve e não derruba o do dono.
  - Os atos que fecham o gate cancelam o Approve venha de quem vier: a retirada, um título quase-Approve, um `# Plano`, uma edição, um comentário apagado, uma reabertura da issue e uma aplicação posterior da `ready-for-agent` por outro ator (conta só a última aplicação, e ela precisa ser do dono). Na dúvida, o gate bloqueia. Exigir o dono só na linha exata da retirada não fecharia nada, porque as formas vizinhas e o `# Plano` de qualquer autor também cancelam.
- **A retirada.** Um comentário cuja primeira linha é exatamente `# Approve retirado` retira o Approve que estava de pé, de qualquer autor.
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
- **O limite de leitura.** Com mais de 100 comentários ou mais de 100 eventos na issue, o passo `approve` bloqueia e explica: o gate se recusa a julgar o que não conseguiu ler inteiro. O mesmo vale para as labels: com mais de 100 labels na issue, ou quando o GitHub não diz quantas ela tem (`totalCount`), os passos `kind` e `state-label` bloqueiam, porque uma label de categoria ou de estado pode estar entre as que ficaram sem ler; numa branch `fix/`, o passo `branch` fica sem conferir a categoria.

### O que ele não consegue fazer

Este repositório tem uma conta só no GitHub. O dono e o agente postam com o mesmo login, então nada nos metadados de uma issue distingue um comentário do dono de um que o agente escreveu com a voz do dono. Nenhum script rodado com essa conta fecha esse buraco. Por isso o gate imprime, em toda execução, inclusive nas que passam:

> Ao publicar um plano completo numa issue em `needs-triage`, o agente a troca por `ready-for-human`. Só o dono escreve o Approve e aplica `ready-for-agent`.

- Mover `ready-for-human` para `ready-for-agent` é um ato do dono. É um segundo ato deliberado, e o gate exige que ele venha depois do Approve: é isso que dificulta fabricar um Approve por acidente.
- Um Approve são as palavras do dono. Uma aprovação dada no chat não é Approve, e o agente nunca a transcreve para a issue.
- Numa sessão do Claude Code deste projeto, os hooks da #5 impedem o agente de escrever o Approve. Fora delas, só essa regra escrita o impede ([ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)).
- O gate não sabe quem resolveu uma thread nem se ela foi respondida antes: `resolvedBy` é sempre o login do dono, e o motivo da resolução não se lê de volta. Numa sessão do Claude Code deste projeto, o `guard-bash` nega resolver uma thread cujo último comentário não é de quem resolve; fora delas, responder antes de resolver é regra escrita. Uma thread apagada também some do gate, e nada registra isso ([ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md)).
- O gate data o Approve pelo `createdAt` dele e não conta as edições do próprio Approve. Um comentário postado antes da label e editado depois para virar `# Owner Approve` parece um Approve antigo seguido da label. Separar os dois exige ler a primeira versão do comentário (`userContentEdits` no GraphQL). Até lá, esse caso fica com a regra escrita, e os hooks da #5 pedem confirmação antes de o agente editar um comentário e negam uma edição que o transforme em Approve.

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
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Status

- **Criado**: 2026-09-24 (Fase: Build), do gate do lite-campaign (brunohab/lite-campaign#101), dos três defeitos dele e do plano aprovado na #2 (#2)
- **Status**: Active
- **Atualizado**: 2026-09-25 (Fase: Build), a regra de autoria passou a distinguir a transição `needs-triage` para `ready-for-human`, feita pelo agente ao publicar o plano, do Approve e da aplicação de `ready-for-agent`, exclusivos do dono (#17)
- **Atualizado**: 2026-09-27 (Fase: Build), uma fatia de stack passou a ser julgada pela mãe: o estado, o plano, o Approve e a branch na seção `Stack`; o `pr-base` passou a aceitar a fatia de baixo em draft, o `stacked` a isentar as fatias da mesma stack, o `intent-first` e o `learn` a bloquear pela posição da fatia, e o `pr-size` novo a relatar o tamanho da PR (#31)
- **Atualizado**: 2026-09-28 (Fase: Build), os hooks da #5 passaram a ler o cache pelo `gateStatus()`, com o plano pendente fechando o cache até ser publicado, e a fazer valer, numa sessão do Claude Code, o Approve do dono e responder antes de resolver (#5)
