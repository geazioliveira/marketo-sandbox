# Fluxo de desenvolvimento

Toda mudança segue o mesmo loop: Intent, Build e Learn do Context Mesh, com Plan, Approve e Execute dentro do Build. Este guia dá a ordem e os comandos. As regras de cada passo ficam nos patterns que ele aponta, e a [ADR 0001](../../context/decisions/0001-context-mesh-in-the-repository.md) registra a decisão por trás do loop.

## O loop

Antes de tudo, e de novo antes da PR:

```sh
npm run gate
```

`npm run gate` antes de começar e de novo antes da PR. O gate lê a branch, descobre a issue, e diz quais passos estão feitos, quais faltam e se o Build pode começar. [O gate do loop](../../context/knowledge/patterns/loop-gate.md) diz o que bloqueia, o que só é relatado e o que nenhum script consegue conferir.

1. **Issue.** O plano nasce numa issue de `geazioliveira/marketo-sandbox`, com as seções listadas abaixo, a label de categoria e a label `ready-for-human`. Os forms de issue aplicam as duas. Um relato sem plano entra com `needs-triage`; quando o agente publica o plano, troca `needs-triage` por `ready-for-human` no mesmo passo.
2. **Approve.** O dono lê o plano no GitHub, comenta `# Owner Approve` com as próprias palavras e, depois desse comentário, move a label de `ready-for-human` para `ready-for-agent`. A ordem importa: o gate só aceita um `ready-for-agent` aplicado depois do Approve em vigor. O agente nunca faz nenhum dos dois.
3. **Branch.** Uma branch para a issue, cortada do `origin/main`, como manda o [ciclo de vida de issue e branch](../../context/knowledge/patterns/issue-branch-lifecycle.md). Uma issue tem uma branch só: outra branch da mesma issue que compartilhe história não publicada com esta bloqueia o gate, e só esta branch e a cópia dela em `origin` ficam de fora ([o passo `stacked`](../../context/knowledge/patterns/loop-gate.md#o-passo-stacked)). Numa stack, cada fatia é cortada da fatia logo abaixo ([Stack de PRs](#stack-de-prs)). Rode `npm run gate` aqui: ele precisa estar aberto antes do primeiro commit.
4. **Intent.** O primeiro commit toca só `context/intent/`: cria ou atualiza o `feature-<slug>.md` ou o `bug-<slug>.md` da issue, com status `In Progress`.
5. **Build.** Implementa o plano aprovado, commit por commit, cada mensagem terminando com `Refs #N`. Se algo muda o plano, pare (veja a seção sobre o plan mode).
6. **Learn.** Na mesma branch, antes de a PR sair de draft: o intent ganha Resultados e o status final (`Completed` ou `Resolved`), o [changelog](../../context/evolution/changelog.md) ganha uma entrada cujo heading cita `(#N)`, e as decisões e os patterns novos entram em `context/`.
7. **Check.** Roda os checks (seção Check, abaixo), abre a PR em draft com a primeira linha `Closes #N.` e liga nela o monitor de CI do app. A PR só sai de draft com o Learn commitado, e sair de draft pede a revisão do Copilot.
8. **Review.** A PR é revisada com a profundidade que o risco do plano pede (`HIGH` ou `NORMAL`). CI verde não é revisão. O Copilot revisa a cabeça da PR, e cada thread de revisão é respondida e só então resolvida ([A revisão do Copilot e as threads](#a-revisão-do-copilot-e-as-threads)).
9. **Merge.** Merge commit, com os checks exigidos verdes, uma revisão do Copilot na cabeça, nenhuma thread de revisão aberta, um veredito fresco do gate e a revisão feita (seção Pull requests e merge). Depois, um comentário na issue com o número da PR e o SHA do merge.

## Plan mode do Claude Code

O plano redigido no plan mode do Claude Code é um rascunho do plano de uma issue. Aceitar o plano no Claude Code só autoriza postá-lo na issue. Não autoriza escrever código.

A sequência:

1. No plan mode, o agente redige o plano, com as seções exigidas e o nome exato da branch.
2. O agente cria a issue (`gh issue create … --label enhancement --label ready-for-human`) ou, numa issue que já existe, posta um comentário cuja primeira linha é exatamente `# Plano`. Se ela está em `needs-triage`, troca essa label por `ready-for-human` logo após publicar o comentário.
3. O agente para e informa o link da issue.
4. O dono lê no GitHub, escreve `# Owner Approve` com as próprias palavras e, depois, move a label.
5. Num turno novo, o agente roda `npm run gate` e só então constrói.

- Aprovação no chat não é Approve, e o agente nunca a transcreve para a issue.
- O hook `plan-to-issue` marca o plano aceito como pendente. Até ele ser publicado, o `build-guard` pede confirmação para editar fora de `context/intent/` ([Os hooks do Claude Code](#os-hooks-do-claude-code)).
- Se o Build descobre algo que muda o plano: o agente para, posta um novo comentário cuja primeira linha é exatamente `# Plano`, com o plano inteiro revisado (isso cancela o Approve, de propósito), e espera o dono aprovar de novo. Se a issue voltou a `needs-triage`, o agente a move para `ready-for-human`. Depois do novo Approve, o dono remove `ready-for-agent` e a aplica de novo, mesmo que ela nunca tenha saído da issue: o gate só aceita a label aplicada depois do Approve em vigor.

## Seções que uma issue precisa ter

A lista vive em [scripts/loop-sections.mjs](../../scripts/loop-sections.mjs) (`featureSections`, `bugSections` e `optionalSections`), e os forms de issue em `.github/ISSUE_TEMPLATE/` a espelham, com um teste de paridade. Esta página cita a lista. Se as duas divergirem, vale o script.

Feature (label `enhancement`):

- Contexto e porquê: o problema e por que resolvê-lo agora.
- Estado atual: citações medidas do código (arquivo:linha, SHA), inclusive o que contradiz o plano.
- Critérios de aceite: itens de checklist verificáveis; marcados só em context/intent, nunca no corpo.
- Plano: os commits em ordem e o nome exato da branch.
- Riscos: HIGH ou NORMAL e o raciocínio, que decide a profundidade da revisão.
- Perguntas para o Approve: cada uma com recomendação, alternativa e custo.

Bug (label `bug`):

- O que acontece: o comportamento, como quem usa o encontra.
- Como reproduzir: os passos, para que a correção tenha algo que falhe antes.
- Causa raiz: por que acontece, não só onde.
- Onde será corrigido: o arquivo ou a issue que é dona da correção, e o nome exato da branch.
- Critérios de aceite: o teste que falha antes e passa depois.
- Riscos: HIGH ou NORMAL e o raciocínio.

Opcionais, nunca exigidas: Issue mãe, Bloqueada por e Fora de escopo.

- Os headings podem ir de `#` a `####`. A comparação ignora acento, caixa e pontuação no fim, e aceita alguns nomes alternativos em pt-BR (por exemplo, "Contexto" ou "Critérios de aceitação"; a lista está em `alternativeHeadings`). Headings em inglês são recusados de propósito.
- Um heading igual ao nome da seção vence um que só começa com ele: com `### Plano de testes` antes de `### Plano`, a seção Plano é a segunda. Sem nenhum heading igual, vale o primeiro que começa com o nome, como `Riscos: HIGH`.
- Um campo de form deixado em branco (`_No response_`) conta como seção vazia.
- A seção Plano cita o nome exato da branch, como `feature/2-loop-minimo`. Num bug, que não tem Plano, quem cita é a seção Onde será corrigido. O gate procura o nome só dentro dessa seção.
- Os critérios de aceite são itens de checklist (`- [ ] …`), pelo menos um.
- O gate lê o plano como o GitHub o mostra. Uma caixa dentro de um bloco de código ou de um comentário HTML (`<!-- … -->`) não conta como critério, e um heading dentro de um deles não abre seção: uma seção exigida que só existe comentada falta.
- Os comentários HTML não contam como conteúdo nem como citação: uma seção que só traz um comentário, como `<!-- HIGH ou NORMAL -->`, está vazia, e uma branch citada só dentro de um comentário não conta. Um bloco de código é texto visível: conta como conteúdo e como citação da branch, só não como critério.
- Um bloco de código dentro de um item de lista, mesmo indentado com quatro espaços ou mais (`1. Exemplo:` e, abaixo, a cerca indentada), também é código, e uma caixa nele não conta. Fora de uma lista, uma linha indentada com quatro espaços ou mais é código indentado, que o gate não reconhece: uma caixa nele ainda conta.

## Regras do corpo da issue

- **Nunca edite o corpo depois do Approve.** O gate compara o `lastEditedAt` do corpo com o Approve e bloqueia. Uma revisão entra como um comentário novo cuja primeira linha é exatamente `# Plano` e traz o plano inteiro, porque o último `# Plano` passa a ser o plano vigente.
- **Nem os comentários.** Depois do Approve, editar qualquer comentário, anterior ou posterior a ele, ou apagar qualquer comentário também revoga o Approve. Editar o próprio comentário de Approve não revoga: são as palavras do dono. Uma correção vai num comentário novo.
- **Respostas às perguntas vão em comentário novo**, nunca no corpo.
- **Os critérios são marcados só em `context/intent/*`.** Clicar num checkbox do corpo edita o corpo e revoga o Approve.

## Comentários que o gate lê

O gate lê a primeira linha não vazia de cada comentário da issue, sem os espaços das pontas, e a linha logo abaixo dela, que pode sublinhar a primeira como título. Três primeiras linhas têm sentido, e só escritas exatamente assim: um `#`, um espaço, essa caixa, e nada mais na linha.

| Primeira linha | Quem escreve | Efeito |
| --- | --- | --- |
| `# Owner Approve` | Só o dono, com as próprias palavras nas linhas de baixo | Aprova o plano vigente |
| `# Approve retirado` | O dono, por convenção. O gate aceita a retirada de qualquer autor | Retira o Approve que estava de pé |
| `# Plano` | O agente ou o dono, com o plano inteiro nas linhas de baixo | Revisa o plano: passa a ser o plano vigente e cancela o Approve que estava de pé |

- **Só o que abre o gate exige o dono.** O gate confere o autor só no `# Owner Approve` e na aplicação da `ready-for-agent`. A retirada, um título quase-Approve, um `# Plano`, uma edição, um comentário apagado, uma reabertura da issue e uma aplicação posterior da `ready-for-agent` por outro ator cancelam o Approve venha de quem vier, porque na dúvida o gate bloqueia. Um `# Owner Approve` de outro autor não conta e não derruba o do dono, mas a `ready-for-agent` aplicada por outro ator derruba: conta só a última aplicação, e ela precisa ser do dono.
- **Na dúvida, bloqueia.** Qualquer outra primeira linha numa destas formas de título que mencione "approve", em qualquer caixa, nunca conta como Approve e, depois de um Approve, o cancela. As formas: um heading de `#` a `######`, com os `#` seguidos de espaço ou de letra; uma primeira linha sublinhada com `===` ou `---` na linha de baixo; uma primeira linha inteira em negrito; e qualquer um deles citado com `>`.
- **Prosa não é título.** Uma frase comum que menciona approve não muda nada, e `#5` é uma referência a issue, não um título. Um comentário que não quer mexer no Approve não abre com um título que fale de approve.
- **A label vem depois do Approve.** `ready-for-agent` só conta se a última aplicação dela foi do dono, depois da última reabertura e depois do Approve em vigor.

Exemplos de primeira linha que não é nenhuma das três acima. Um teste confere cada linha desta tabela contra o gate.

| Primeira linha | Efeito |
| --- | --- |
| `## Owner Approve` | Cancela o Approve que estava de pé, e nunca conta como Approve |
| `# owner approve` | Cancela |
| `#Owner Approve` | Cancela |
| `# Approve retirado.` | Cancela |
| `# Retiro o Approve` | Cancela |
| `# Perguntas para o Approve` | Cancela |
| `##### Approve retirado` | Cancela |
| `**Approve retirado**` | Cancela |
| `> # Approve retirado` | Cancela |
| `Approve retirado`, com `===` na linha de baixo | Cancela |
| `Approve retirado`, com `---` na linha de baixo | Cancela |
| `Approve retirado` | Nenhum: é uma frase, não um título |
| `#5 aguarda o Approve` | Nenhum: é uma referência a issue |
| `## Plano` | Nenhum: não é revisão, e o plano vigente não muda |
| `# plano` | Nenhum: não é revisão |
| `# Plano revisado` | Nenhum: não é revisão |

[O gate do loop](../../context/knowledge/patterns/loop-gate.md#a-gramática-do-approve) tem a gramática completa.

## Labels

Toda issue aberta tem exatamente uma label de categoria (`bug` ou `enhancement`) e exatamente uma label de estado. A issue de acompanhamento (#1) fica fora dessa regra, e uma fatia de stack também: ela leva `stack-slice` no lugar da label de estado, porque o estado dela é o da mãe ([Stack de PRs](#stack-de-prs)).

O contrato `agentPlanLabelTransition` em [scripts/loop-sections.mjs](../../scripts/loop-sections.mjs) registra a única edição de label de estado que o agente pode fazer: ao publicar um plano completo como `# Plano` numa issue em `needs-triage`, seja nova ou já existente, troca `needs-triage` por `ready-for-human`. O `guard-bash` (#5) deixa passar só essa exceção, e só numa issue em `needs-triage` cujo último comentário abre com `# Plano`; `ready-for-agent` continua exclusivo do dono.

| Label | Significado | Quem aplica |
| --- | --- | --- |
| `needs-triage` | Relato ainda sem plano para validação | O agente, no `gh issue create` de um relato sem plano, e a [auditoria de main](#auditoria-de-main), na issue que ela abre. Quando publicar o plano, o agente a remove |
| `needs-info` | Esperando mais informação de quem abriu | Só o dono |
| `ready-for-human` | Há um plano publicado que precisa da validação do dono | O form de issue ou o agente ao criar uma issue com plano ou publicar `# Plano` numa issue em `needs-triage`. O dono a remove depois do Approve |
| `ready-for-agent` | Especificada e aprovada pelo dono: o agente pode construir | Só o dono, depois do Approve, e de novo depois de cada novo Approve |
| `wontfix` | Não será feita (decisão do dono) | Só o dono |
| `stack-slice` | Fatia de uma stack: o estado e o Approve são os da issue mãe | O agente, no `gh issue create --parent <mãe>` de cada fatia (#31). Não é label de estado |

A label de categoria é aplicada pelo form de issue, pelo agente no `gh issue create` ou pela auditoria de `main` (sempre `bug`). Trocá-la depois é do dono.

## Issue tracker

As issues ficam em `geazioliveira/marketo-sandbox`. PR não é lugar de pedido: ideias e defeitos são issues.

```sh
# Listar e ler
gh issue list --repo geazioliveira/marketo-sandbox --state open
gh issue view <n> --repo geazioliveira/marketo-sandbox --comments

# Criar uma issue com plano, ou um relato sem plano
gh issue create --repo geazioliveira/marketo-sandbox --title "..." --body-file plano.md --label enhancement --label ready-for-human
gh issue create --repo geazioliveira/marketo-sandbox --title "..." --body-file relato.md --label bug --label needs-triage

# Criar uma sub-issue
gh issue create --repo geazioliveira/marketo-sandbox --parent <n> --title "..." --body-file plano.md --label enhancement --label ready-for-human

# Comentar (a primeira linha de um plano revisado é exatamente "# Plano")
gh issue comment <n> --repo geazioliveira/marketo-sandbox --body-file comentario.md

# Agente: depois de publicar o plano numa issue em needs-triage, sinalizar a validação pendente
gh issue edit <n> --repo geazioliveira/marketo-sandbox --remove-label needs-triage --add-label ready-for-human

# Só o dono: mover a label depois do comentário de Approve
gh issue edit <n> --repo geazioliveira/marketo-sandbox --remove-label ready-for-human --add-label ready-for-agent

# Só o dono: aplicar a label de novo depois de um novo Approve (revisão do plano)
gh issue edit <n> --repo geazioliveira/marketo-sandbox --remove-label ready-for-agent
gh issue edit <n> --repo geazioliveira/marketo-sandbox --add-label ready-for-agent

# Abrir a PR em draft (a primeira linha de pr.md é "Closes #N.")
gh pr create --repo geazioliveira/marketo-sandbox --base main --head <branch> --draft --title "..." --body-file pr.md

# Tirar a PR de draft, só com o Learn commitado (isso pede a revisão do Copilot)
gh pr ready <p> --repo geazioliveira/marketo-sandbox

# Depois de um push: quando o Copilot foi pedido na PR (compare com a hora do push)
gh api --paginate repos/geazioliveira/marketo-sandbox/issues/<p>/timeline --jq '.[] | select(.event == "review_requested" and .requested_reviewer.type == "Bot" and .requested_reviewer.id == 175728472) | .created_at'

# Pedir a revisão do Copilot de novo, depois de um push sem pedido nem revisão na cabeça nova
gh pr edit <p> --repo geazioliveira/marketo-sandbox --add-reviewer @copilot

# As threads de revisão da PR, com o id de cada uma
gh api graphql -F owner=geazioliveira -F name=marketo-sandbox -F number=<p> -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid reviewThreads(first: 100) { totalCount nodes { id isResolved isOutdated path line comments(first: 1) { nodes { url author { login } } } } } } } }'

# Responder numa thread (resposta.md traz o SHA da correção, a issue #N ou a evidência)
gh api graphql -f thread=<thread-id> -F body=@resposta.md -f query='mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { url } } }'

# Só depois de responder, resolver a thread (numa thread do Copilot, com o motivo: ADDRESSED, WONT_FIX ou INVALID; numa de outro autor, sem -f reason)
gh api graphql -f thread=<thread-id> -f reason=ADDRESSED -f query='mutation($thread: ID!, $reason: PullRequestReviewThreadResolutionReason) { resolveReviewThread(input: { threadId: $thread, resolutionReason: $reason }) { thread { isResolved } } }'

# Re-executar o issue-link de uma PR a pedido: o refresh, de main; sozinho, não é veredito fresco
gh workflow run issue-link-refresh.yml --repo geazioliveira/marketo-sandbox --ref main -f pr=<p>

# Acompanhar os checks
gh pr checks <p> --repo geazioliveira/marketo-sandbox

# Veredito fresco logo antes do merge: num checkout da head da PR com origin/main buscado, o gate em modo CI (exige saída 0)
node scripts/gate.mjs --pr <p> --branch <branch>

# As últimas runs do refresh do issue-link e da auditoria de main
gh run list --repo geazioliveira/marketo-sandbox --workflow issue-link-refresh.yml --limit 5
gh run list --repo geazioliveira/marketo-sandbox --workflow main-audit.yml --limit 5

# Auditar main agora, sem esperar o próximo push nem a execução diária
gh workflow run main-audit.yml --repo geazioliveira/marketo-sandbox --ref main

# As issues abertas pela auditoria de main
gh issue list --repo geazioliveira/marketo-sandbox --state all --search '"Mudança em main fora do loop" in:title'

# Mergear
gh pr merge <p> --repo geazioliveira/marketo-sandbox --merge

# Depois do merge
gh issue comment <n> --repo geazioliveira/marketo-sandbox --body "Fechada pela PR #<p> no merge <sha>."
```

- Passe `--repo` sempre. Mais de uma conta pode estar logada na máquina, e uma conta sem acesso vê o repositório como inexistente.
- Use `--body-file` para texto de mais de uma linha. Assim a primeira linha chega exatamente como foi escrita, sem surpresa de quoting do shell.
- Leia de volta toda mudança feita para fora. Um comando com flag errada pode falhar sem erro visível.
- Uma sub-issue nomeia a issue mãe numa seção `Issue mãe`, além do vínculo nativo do `--parent`.

## Pull requests e merge

- **A primeira linha do corpo é `Closes #N.`**, com o número da issue da branch, e a PR fecha só essa issue: nenhuma outra palavra-chave de fechamento no corpo.
- **O template de PR** (`.github/pull_request_template.md`) tem as seções Risco, O que mudou, Verificação, Desvios do plano aprovado, Follow-ups e o checklist do Context Mesh.
- **Os checks exigidos são `Qualidade / check` e `Vínculo com issue / issue-link`**, nomeados por workflow e job. Um job chamado `check` ou `issue-link` que venha de outro workflow não conta: uma PR consegue acrescentar um. E o `issue-link` que conta é o do evento `pull_request_target`, que roda o `.github/workflows/issue-link.yml` de `main` (`gh pr checks --json` mostra o `event`): uma PR consegue acrescentar um workflow de mesmo nome que roda em `pull_request`. No plano Free, o GitHub não consegue torná-los obrigatórios ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)), então a regra é esta: nenhuma PR é mergeada com um check exigido vermelho, e um check ausente conta como vermelho.
- **A revisão do Copilot na cabeça e nenhuma thread aberta.** Desde a #13, o merge exige uma revisão do Copilot no commit que é a cabeça da PR e nenhuma thread de revisão aberta, de qualquer autor, inclusive as desatualizadas ([ADR 0003](../../context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). Desde a #30, o `issue-link` só relata as duas coisas, com um aviso na PR, e quem as exige é o veredito fresco, o hook de `gh pr merge` e a auditoria de `main`. O caminho até lá está em [A revisão do Copilot e as threads](#a-revisão-do-copilot-e-as-threads). Não há bypass: com o Copilot fora do ar, a PR espera.
- **Veredito fresco antes do merge.** O `issue-link` só roda com eventos da PR. Os eventos da issue (o Approve retirado, um `# Plano` novo, a label movida, uma reabertura) dependem do refresh (abaixo), então um verde pode estar velho. E, desde a #30, ele só relata a revisão do Copilot e as threads. Logo antes de mergear, tire um veredito fresco: rode `node scripts/gate.mjs --pr <p> --branch <branch>` num checkout da head da PR, com `origin/main` buscado, e exija saída 0. Um rerun do job `issue-link` não é veredito fresco: ele roda com `--review-report` e não julga a revisão nem as threads. Um disparo do refresh (`gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`) sozinho também não é veredito fresco: o comando volta antes de o refresh rodar, e um refresh que falha não aparece na PR.
- **Nenhum check em andamento no merge.** Logo antes de mergear, também à mão pela web, confira que nenhuma run do `Vínculo com issue / issue-link` nem do `Qualidade / check` está na fila ou em andamento na cabeça: `gh pr checks <n>` sem nenhum `pending`. O hook de `gh pr merge` (#5) já nega o merge nesse caso, mas só para o agente. Uma run que começa antes do merge e termina depois julga a PR no meio dele: o refresh re-executa o `issue-link` a cada evento na issue, e a re-execução lê a issue já fechada pelo próprio merge e termina vermelha. Foi o que aconteceu no merge da PR #43, e a auditoria registra esse merge com o motivo de um check em andamento (#46, #48).
- **O refresh não dispensa o veredito fresco.** Desde a #3, o workflow `Atualiza vínculo com issue` (`.github/workflows/issue-link-refresh.yml`) re-executa o `issue-link` das PRs abertas que fecham a issue, a run do evento `pull_request_target`, a cada label, comentário, edição, fechamento ou reabertura nela. Desde a #31, também o das PRs que fecham as sub-issues dela com a label `stack-slice`, porque uma fatia de stack é julgada pela mãe. Uma sub-issue com as labels lidas pela metade entra também, porque a label pode estar entre as que ficaram sem ler. Ficam de fora a PR de uma fatia com base na fatia de baixo, que o GitHub não liga à sub-issue, e as fatias irmãs de uma fatia que recebeu o evento. O rerun pedido com o `GITHUB_TOKEN` passa: foi medido ao vivo, nas runs 36263677912 (tentativa 2) e 36269762597 (tentativas 3 e 4). Ele também re-executa o `issue-link` de uma PR a pedido, com `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`, que sozinho não é veredito fresco. Desde a #30, uma revisão não o dispara mais: o `issue-link` só relata a revisão e as threads, e o sinal de revisão que o re-executava depois de cada revisão saiu. O disparo é de `main` (`--ref main`): um `workflow_dispatch` roda o YAML e o script da ref em que foi disparado, e o job pula um disparo de outra ref. E ele não cobre tudo: uma run do `issue-link` ainda na fila ou em andamento é consultada a cada 15 s e esperada por até 4 minutos e, se não termina, o refresh fica vermelho sem re-executá-la; o GitHub re-executa uma run no máximo 50 vezes, e só por 30 dias; e vincular a issue pela barra lateral da PR não dispara nada. Por isso a regra acima fica ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)).
- **Nenhum token de pular CI.** Nem o título da PR, nem o corpo da PR, nem mensagem de commit nenhuma levam, escritos literalmente, `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ou `[actions skip]` (a lista é `skipCiTokens`, em `scripts/loop-sections.mjs`), nem um último parágrafo com o trailer `skip-checks: true` (`skipChecksTrailer`), que o GitHub também obedece. A mensagem do merge commit é o título mais o corpo da PR (`PR_TITLE` e `PR_BODY`), então um desses tokens ali faz o push do merge em `main` não disparar nem o `Qualidade / check` nem a auditoria de `main`, que só o julga na execução seguinte. Na mensagem do commit da head, ele deixa a PR sem o `Qualidade / check`, e a auditoria registra o merge (`PR #P mergeada sem Qualidade / check verde`). Para citar um token, descreva-o sem os colchetes.
- **Exceção de bootstrap, só na #2.** A PR da #2 cria o `issue-link`, e por isso não tem esse check no servidor: o workflow ainda não está em `main` ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)). Só nela, a saída do gate em modo CI rodado localmente, colada em "Verificação", faz as vezes do `issue-link`, e o veredito fresco é essa execução refeita logo antes do merge, com saída 0. Da PR da #3 em diante, o `issue-link` do servidor é exigido.
- **PR que mexe em workflow é HIGH.** Uma PR que toca `.github/workflows/**` é revisada como risco HIGH, seja qual for o risco do plano. O `check.yml` roda em `pull_request`, com o YAML e o `package.json` da própria PR, então a PR consegue afrouxar o próprio `check`. Só o `issue-link`, que vem de `main`, não pode ser afrouxado pela PR.
- **O tamanho da PR é só relatado.** O passo `pr-size` do `issue-link` dá as linhas alteradas contra a base, com 1.500 como referência (`prSizeLimit`). Acima disso, ele fica sem [x] e sugere quebrar a mudança numa stack ([Stack de PRs](#stack-de-prs)), mas não bloqueia.
- **Merge só por merge commit** (`gh pr merge --merge`). Squash e rebase estão desligados no repositório, e o título e o corpo do merge commit vêm da PR, então o `Closes #N.` chega ao histórico de `main`.
- **Quem mergeia.** O dono deu ao agente uma autorização permanente para mergear, na #2, em 2026-09-24, na resposta à pergunta 3: "Pode mergiar, se já está tudo ok e validado, não vejo problema." Ela vale quando as três condições se cumprem: os checks exigidos estão verdes, o veredito fresco saiu com 0 e a revisão está feita. Desde a #13, o veredito fresco só sai com 0 com a revisão do Copilot na cabeça e nenhuma thread aberta. Faltando uma, o agente não mergeia. O dono revoga a autorização com um comentário, e a partir dele o agente para de mergear.
- **Depois do merge**, comente na issue o número da PR e o SHA do merge. A issue fecha sozinha pelo `Closes #N.`, e a branch remota é apagada pelo repositório.

## Stack de PRs

Uma mudança grande demais para uma PR vem numa stack: PRs pequenas, uma sobre a outra, cada uma com revisão e merge próprios (#31). O [ciclo de vida de issue e branch](../../context/knowledge/patterns/issue-branch-lifecycle.md#numa-stack) dá as regras, e [o gate do loop](../../context/knowledge/patterns/loop-gate.md#uma-fatia-de-stack), o que ele confere.

1. **As sub-issues.** Uma por fatia, filha da issue mãe, com a label de categoria e `stack-slice`, sem label de estado. A mãe leva a categoria e o estado, como toda issue, e nunca `stack-slice`:

   ```sh
   gh issue create --repo geazioliveira/marketo-sandbox --parent <mãe> --title "<fatia>" --label enhancement --label stack-slice --body "Fatia da stack da #<mãe>."
   ```

2. **O plano da mãe.** Um `# Plano` na mãe com as seções de sempre e uma seção `## Stack`, uma só, com as branches das fatias, de baixo para cima: uma lista numerada, na primeira coluna, cada item começando com a branch num code span. Um bullet ou um parágrafo na seção é prosa e não vira fatia. Bloqueiam a stack um item numerado que não começa com uma branch e a branch de uma issue que não é fatia da mãe (sub-issue dela, deste repositório, com `stack-slice`):

   ```markdown
   ## Stack

   1. `feature/<sub-1>-<slug>`
   2. `feature/<sub-2>-<slug>`
   ```

   O dono aprova a mãe, e o Approve vale para todas as fatias. Um `# Plano` novo na mãe revoga o Approve de todas.
3. **As branches.** A primeira é cortada do `origin/main`, e cada outra, da fatia logo abaixo:

   ```sh
   git fetch origin && git switch -c <fatia> origin/<fatia de baixo>
   git branch --unset-upstream
   ```

   O intent vai no primeiro commit da primeira fatia, e o Learn, com a entrada do changelog citando a mãe, na última. Todo commit de uma fatia cita a sub-issue dela (`Refs #<sub>`): acima da primeira fatia, isso bloqueia no CI.
4. **As PRs.** Cada uma fecha só a sua sub-issue (`Closes #<sub>.`). A primeira aponta para `main`. Cada outra aponta para a fatia de baixo e fica em draft até ela ser mergeada; o gate só aceita `main` como base dela depois de toda fatia de baixo mergeada:

   ```sh
   gh pr create --repo geazioliveira/marketo-sandbox --draft --base <fatia de baixo> --title "<título>" --body-file <corpo>
   ```

   A revisão do Copilot de uma fatia em draft é pedida à mão, com `gh pr edit <n> --add-reviewer @copilot`. Com a base na fatia de baixo, o GitHub não liga a PR à sub-issue, e o gate lê o `Closes #<sub>.` do corpo. Quando a PR passa a apontar para `main`, vale o vínculo do GitHub, mas ele não aparece sozinho. Na stack da #5, o GitHub mudou a base da PR de cima para `main` no merge da de baixo e não a ligou à sub-issue; uma edição no corpo da PR criou o vínculo na hora. Por isso, depois do merge da de baixo, edite o corpo da PR de cima: atualizar o que mudou e a verificação basta.

   O Copilot não revisa uma PR grande demais. Na stack da #5, uma PR com 241.186 bytes de diff (`gh pr diff <n> | wc -c`) recebeu três revisões falhas ("Copilot wasn't able to review any files"), e as de até 222.324 bytes foram revisadas. A margem é 180 KiB, adotada depois das falhas: uma fatia acima dela se divide em duas, com os testes cortados entre blocos `describe` de nível zero. Na #5, a fatia das regras do `gh` caiu de 241.186 para 179.248 bytes e foi revisada. Um teste que lê um arquivo de uma fatia de cima vai com esse arquivo.
5. **Atualizar uma fatia.** Uma correção numa fatia de baixo sobe para a de cima por merge, nunca por rebase nem force-push:

   ```sh
   git fetch origin && git merge origin/<fatia de baixo>
   ```

   Nunca o contrário: a fatia de cima trazida para a de baixo, por merge ou fast-forward, bloqueia o `stacked` da de baixo.

6. **O merge.** De baixo para cima, cada uma com as condições de sempre ([Pull requests e merge](#pull-requests-e-merge)). Quando a branch de baixo é apagada no merge, o GitHub aponta a PR de cima para `main`. Se não apontar, use `gh pr edit <n> --base main`. Então a PR sai de draft (`gh pr ready`) e segue. Depois do merge da última fatia, a mãe recebe um comentário com as PRs e os SHAs dos merges, e o dono a fecha.

## A revisão do Copilot e as threads

Desde a #13, uma PR só é mergeada com uma revisão do Copilot no commit que é a cabeça dela e nenhuma thread de revisão aberta, de qualquer autor, inclusive as desatualizadas ([ADR 0003](../../context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). O gate confere as duas coisas nos passos `copilot-review` e `review-threads` ([o gate do loop](../../context/knowledge/patterns/loop-gate.md#a-revisão-do-copilot-e-as-threads)). Desde a #30, o `issue-link` roda o gate com `--review-report`: ali os dois passos só relatam, e cada um que bloquearia vira um aviso na PR, uma annotation e o resumo do job. Quem os exige é o veredito fresco (o gate em modo CI, sem a opção), o hook de `gh pr merge` e a auditoria de `main`. Não há bypass: com o Copilot fora do ar, a PR espera, e se o dono mergear mesmo assim, a [auditoria de main](#auditoria-de-main) registra o merge.

O caminho de uma PR:

1. **Abra a PR em draft** (`gh pr create --draft`, no cookbook acima). Em draft, os dois passos só relatam, e o Copilot ainda não revisa.
2. **Ligue o monitor de CI do app** logo depois do `gh pr create`: no app do Claude, o monitor da PR, com auto-fix e comentários ligados (a ferramenta `set_monitor`, com `auto_fix` e `address_comments`). Ele não vem ligado nas PRs que o agente abre, e foi por isso que ninguém respondeu às threads das PRs #10 e #11. Um hook não liga o monitor: é um passo do agente.
3. **Saia de draft só com o Learn commitado** (`gh pr ready <p>`). Sair de draft pede a revisão do Copilot, pela configuração do dono, e ela leva uns 6 min. Assim a revisão cobre a cabeça final, com o Learn.
4. **Espere o Copilot na cabeça.** Cada push novo muda a cabeça, e a revisão de antes deixa de contar. A opção "Review new pushes" da configuração do Copilot do dono pede a revisão sozinha a cada push, mas o agente não vê essa configuração, então confere. Depois de cada push, anote a hora dele e leia a timeline da PR (`gh api repos/geazioliveira/marketo-sandbox/issues/<p>/timeline`, com o filtro do cookbook acima). Se ela não mostra um `review_requested` do Copilot (`Bot` com `id` 175728472) depois da hora do push, e nenhuma revisão do Copilot chegou na cabeça nova em uns 10 min, peça a revisão de novo com `gh pr edit <n> --add-reviewer @copilot`. Uma revisão do Copilot que falhou (o corpo começa com "Copilot encountered an error", "Copilot was unable to review", como quando a cota de Copilot acaba, ou "Copilot wasn't able to review") não conta: peça de novo do mesmo jeito.
5. **Responda cada thread e só então a resolva.** A resposta traz o SHA do commit que corrige o achado, a issue `#N` que fica com ele, ou a evidência de que ele não procede. Depois, resolva a thread; numa thread do Copilot, com o motivo que corresponde à resposta: `ADDRESSED`, `WONT_FIX` ou `INVALID`. Isso vale para as threads de qualquer autor, inclusive as do dono, e para as desatualizadas. O Copilot às vezes resolve sozinho uma thread dele quando um push a deixa desatualizada, sem resposta nenhuma (medido na PR #15): responda nela mesmo assim, com o SHA, para a thread guardar a evidência.
6. **Trate os achados que só aparecem no resumo.** Do corpo da revisão, o gate só lê o começo, para reconhecer uma revisão que falhou. Um achado que aparece só nele, sem thread, ganha a mesma resposta, num comentário da PR. O Copilot não lê as respostas e pode repetir um achado numa revisão nova: responda de novo, citando a resposta anterior.
7. **Renove o veredito.** Resolver uma thread não dispara workflow nenhum, e o `issue-link` não precisa disso: desde a #30 ele só relata a revisão e as threads. O veredito fresco é o de [Pull requests e merge](#pull-requests-e-merge): `node scripts/gate.mjs --pr <p> --branch <branch>` na cabeça da PR, com saída 0. As mensagens de `copilot-review` e `review-threads` terminam com esse comando do gate.
8. **Mergeie** pela regra de [Pull requests e merge](#pull-requests-e-merge).

Quando um dos dois passos dá não:

| Passo | Quando dá não | O que fazer |
| --- | --- | --- |
| `copilot-review` | Não há revisão do Copilot na cabeça: nenhuma ainda, a última cobre outro commit, ela falhou, ou ela está num estado que não conta (contam `COMMENTED` ou `APPROVED`). Ou há, mas outra revisão do Copilot foi pedida e ainda não chegou. Com mais de 100 revisões, nenhuma que conte entre as 100 mais recentes deixa o passo `[?]` | Com uma revisão a caminho (pedida ao sair de draft ou por você), espere-a, uns 6 min, e trate as threads dela; se ela não chegar em uns 10 min, peça de novo. Sem nenhuma a caminho (a última falhou, cobre outro commit ou não conta), peça já com `gh pr edit <n> --add-reviewer @copilot`. Depois, renove o veredito (passo 7 acima) |
| `review-threads` | Há uma thread de revisão não resolvida, de qualquer autor, inclusive desatualizada. A mensagem dá `path:line` e o link de cada uma | Responda e resolva cada thread (passo 5 acima) e renove o veredito (passo 7 acima) |

Nada re-executa o `issue-link` depois de uma revisão, e desde a #30 isso não o deixa vermelho. Até a #30, o `Sinal de revisão` rodava a cada revisão para o refresh re-executar o check, mas a revisão do próprio Copilot deixava a run do sinal em `action_required` (o GitHub pede aprovação para uma run disparada por bot), e uma revisão sem comentários nem a criava: o check ficava vermelho até um rerun à mão. O sinal e o modo `workflow_run` do refresh saíram com a #30. O aviso da run do `issue-link` (a annotation e o resumo do job) mostra o que o merge ainda espera, e o veredito fresco o confere logo antes do merge ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)).

## Check

Antes da PR, o mesmo que o CI roda, e o gate:

```sh
npm run check && npm run test:e2e && npm run gate
```

- **`npm run check`** roda, nessa ordem e parando no primeiro erro: `npm run lint` (oxlint em `src/`, `test/`, `scripts/` e `.claude/hooks/`), `npm run format:check` (`prettier --check` em `src/`, `test/`, `scripts/` e `.claude/hooks/`, os mesmos arquivos que o script `format` reescreve), `npm run typecheck` (`tsc --noEmit`, que cobre `src/` e `test/`), `npm test` (vitest), `npm run check:context`, `npm run build` (nest build, que escreve em `dist/`, ignorado pelo git) e `npm run check:all` (os três geradores em `--check`: a saída commitada tem de ser a que eles emitem). Desde a #7, os testes unitários (pelo `test/scripts/codegen.spec.ts`), e com eles o `npm run check`, pedem um python3 3.9 ou mais novo no `PATH` e o `npm ci` feito: sem o Prettier ou sem node, os geradores saem com 2 e dizem por quê. Desde a #19, eles pedem também um checkout git, para o `git check-attr` dos documentos Swagger.
- **`npm run check:context`** (`scripts/check-context.mjs`) lê `context/`, `docs/`, `AGENTS.md` e `CLAUDE.md`, e os links do template de PR. Cada problema sai com `arquivo:linha`, e os formatos estão no [guia do Context Mesh](../../context/README.md). Ele recusa:
  - link relativo ou âncora quebrados, a âncora do próprio arquivo (`#…`) inclusive;
  - arquivo fora do layout. As pastas e os nomes de `context/` estão no [Layout do guia](../../context/README.md#layout), e um arquivo fora destas pastas faz o check:context recusar a árvore; uma pasta nova entra antes em `scripts/loop-sections.mjs` e no Layout. Só um arquivo oculto que não é markdown (`.DS_Store`, `.obsidian/`) fica de fora;
  - arquivo de contexto sem o título `# <Tipo>: <assunto>`, ou sem um único bloco Status como última seção (nem um título sublinhado depois dele), com um status válido e nenhum status declarado fora dele (numa lista, numa citação ou em negrito solto);
  - no bloco Status, desde a #66, uma linha `Atualizado` fora do formato do [guia](../../context/README.md#o-bloco-status) ou datada antes do `Criado` ou da mais nova acima dela, e, fora das decisões, qualquer linha `Atualizado` depois da primeira;
  - decisão fora do [índice de decisões](../../context/decisions/README.md) ou com status diferente do arquivo;
  - título de entrada do changelog fora do formato;
  - caminho absoluto de máquina (`/Users/`, `/Volumes/`, `/home/<x>/`, `/private/tmp/`, `/private/var/`, `/var/folders/`, `/tmp/<x>/`);
  - no template de PR, qualquer link relativo. O template vira o corpo da PR, onde um link relativo resolve a partir da página da PR e dá 404. Lá o link aponta para `https://github.com/geazioliveira/marketo-sandbox/blob/main/<caminho>`, que o check confere como um link relativo, ou não há link.
- **O e2e** (`npm run test:e2e`) sobe o app inteiro e confere que uma rota de assets responde com o envelope do Marketo e que `/` responde 404. Desde a #9 o app não manda telemetria, então o e2e roda sem variável de ambiente nenhuma.
- **No CI**, o job `check` (`Qualidade / check`) roda em toda PR, em todo push em `main` e à mão. Os passos são `npm ci`, `npm run check`, o passo `e2e` (`npm run test:e2e`) e a conferência de que a árvore ficou limpa. Numa PR, um push novo cancela a run velha. Em `main`, nenhuma run é cancelada nem substituída: cada commit tem o seu grupo de concorrência, e todo push em `main` que dispara run ganha um veredito; o que um push sem run trouxe entra na auditoria seguinte ([Auditoria de main](#auditoria-de-main)).
- O `npm run check:all` passa desde a #6 e roda dentro do `check` desde a #7, então o CI recusa uma edição num arquivo gerado, um `.ts` a mais numa pasta gerada e, desde a #19, um Swagger mudado sem regenerar ([ADR 0012](../../context/decisions/0012-swagger-source-record-per-area.md)). Numa PR que toca um gerador, um Swagger ou uma pasta gerada, o caminho está em [gerar e conferir](../../context/knowledge/patterns/generate-and-check.md).

## Auditoria de main

O workflow `Auditoria de main` (`.github/workflows/main-audit.yml`, com as regras em `scripts/audit-main.mjs`) confere, depois do fato, que cada commit que chegou a `main` veio de uma PR mergeada que fecha uma issue e que tinha os checks exigidos verdes e, desde a #13, a revisão do Copilot na cabeça e nenhuma thread aberta. No plano Free nada impede um desvio antes ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)); a auditoria faz dele uma issue.

- **Quando ela roda.** A cada push em `main`, uma vez por dia (cron `17 6 * * *`) e à mão (`gh workflow run`, no cookbook acima).
- **Os dois passos.** O passo `Julgar` julga o intervalo, abre ou comenta as issues e grava quantos commits ficaram fora do loop; ele só termina com `success` quando julgou o intervalo inteiro, e falha quando o `gh` ou o git o interrompem. O passo `Veredito` deixa a run vermelha quando esse número é maior que zero, ou quando o `Julgar` não o gravou. Assim uma run vermelha que julgou tudo se distingue de uma que parou no meio.
- **O que ela lê.** A linha do primeiro pai de `main`, do último commit auditado até o topo (o `after` do push, ou o `HEAD` de `main` no agendamento e à mão). O último commit auditado é o topo da run mais recente do `main-audit.yml` em `main`, com id menor que o da run atual, cujo passo `Julgar` terminou com `success`, entre as 20 runs concluídas mais recentes: só conta como auditada a run cujo passo `Julgar` terminou. Uma run interrompida, cancelada ou pulada não conta, e o intervalo dela fica para a auditoria seguinte; um re-run mantém o id, então começa da run anterior a ela. Se o topo dessa run não é ancestral do topo atual, `main` foi reescrito: o topo atual fica fora do loop e o intervalo começa no ancestral comum dos dois (pelo `git merge-base` ou, quando um force-push tirou o topo do clone, pelo compare do GitHub). Se existem runs anteriores e nenhuma das 20 mais recentes terminou o `Julgar`, a auditoria recomeça da linha de base em qualquer evento. Só quando não há run anterior nenhuma, ou o GitHub também não conhece mais o topo dela, vale o `before` do push, ou a linha de base no agendamento e à mão. A saída diz sempre de onde o intervalo começou. Por isso um push que não disparou run nenhuma (um `[skip ci]` na mensagem, um push feito com o `GITHUB_TOKEN`, uma run cancelada ou que saiu da fila) entra na auditoria seguinte, e a execução diária garante que ela venha.
- **O que ela não relê.** O merge de uma PR é um commit só na linha do primeiro pai, e os commits da branch já foram julgados na PR. Os commits até `8d4662f` (`auditBaseline`), o merge da #2 (PR #10), nunca são auditados: até `fb4a804` não havia loop, e o merge da #2 é a exceção de bootstrap, porque o `issue-link` do servidor chegou com ele.
- **O que está no loop.** O merge commit de uma PR mergeada em `main` que fecha pelo menos uma issue deste repositório (pelas referências de fechamento do GitHub ou, na falta delas, pela primeira linha `Closes #N.`, desde que #N seja uma issue e não uma PR) e cuja head estava com `Vínculo com issue / issue-link` e `Qualidade / check` verdes na hora do merge. O `issue-link` só conta vindo de uma run do evento `pull_request_target` do `.github/workflows/issue-link.yml`; o `Qualidade / check` é achado pelo nome, porque roda o YAML da própria PR. Se o GitHub ainda não ligou o merge à PR, a auditoria pergunta de novo até 3 vezes, com 10 s antes de cada tentativa. Desde `2026-09-25T12:00:00Z` (`reviewRuleSince`), a PR também precisa ter tido, até o merge, uma revisão do Copilot na cabeça que não falhou, e não pode ter nenhuma thread de revisão, de qualquer autor e inclusive desatualizada, aberta até o merge e ainda não resolvida na hora da auditoria ([ADR 0003](../../context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md)). As PRs #10 e #11, mergeadas antes, ficam fora dessa regra: a #12 tratou as threads delas.
- **O que fica fora do loop.** Um commit direto em `main` (push direto ou commit pelo editor web), o merge de uma PR que não fecha issue deste repositório, o merge de uma PR sem um check exigido verde (`PR #P mergeada sem <workflow / job> verde`), o merge de uma PR com um check exigido em andamento, cuja run mais nova começou antes do merge e ainda não tinha concluído nele (`PR #P mergeada com <workflow / job> em andamento; a última run concluída antes do merge: <conclusão | nenhuma>`, desde a #48), o merge de uma PR sob a regra de revisão sem revisão do Copilot na cabeça até o merge (`PR #P mergeada sem revisão do Copilot na cabeça <sha7>`) ou com thread de revisão aberta (`PR #P mergeada com <n> thread(s) de revisão aberta(s)`), o merge de uma PR que o GitHub mostra só em parte, um force-push, um histórico de `main` reescrito desde a última auditoria (`histórico de main reescrito desde a última auditoria (execução <id>, em <sha7>)`), e um intervalo com mais de 200 commits pelo primeiro pai. Nos três últimos casos, o registro cai no topo de `main`.
- **Uma página incompleta.** A auditoria lê numa página só as referências de fechamento de uma PR e os checks da head dela. Com mais de 100 referências de fechamento e nenhuma issue deste repositório entre as lidas (`PR #P: mais de 100 referências de fechamento, não lidas todas`), com mais de 100 check suites na head (`PR #P: mais de 100 check suites na head <sha7>, não lidas todas`), ou com mais de 100 check runs numa suite (`PR #P: mais de 100 check runs numa check suite da head <sha7>, não lidos todos`), ela não julga o que ficou sem ler: o merge fica fora do loop com esse motivo, e a issue vai para o dono. Numa PR sob a regra de revisão, o mesmo vale para mais de 100 revisões sem nenhuma do Copilot na cabeça até o merge entre as mais recentes lidas, e para mais de 100 threads de revisão (`auditReviewPage`). Não é uma interrupção, porque um re-run leria a mesma página. O passo `Julgar` termina com `success`, então a run conta como auditada, e a auditoria seguinte não julga esse merge de novo.
- **O que ela faz.** Para cada commit fora do loop, abre sozinha uma issue `bug` + `needs-triage` com o título `Mudança em main fora do loop: <sha7>`, e a run fica vermelha. Com mais de 10 commits fora do loop numa auditoria, abre uma issue só, no topo, que lista todos. Se uma issue com o mesmo título já existe, aberta ou fechada, comenta nela a ocorrência nova em vez de abrir outra (um force-push que volta `main` a um SHA antigo, por exemplo), e a run fica vermelha do mesmo jeito. Se o `gh` ou o git falham, o passo `Julgar` para, e a run fica vermelha com o motivo e o pedido de re-rodá-la (`gh run rerun <id>`); sem o re-run, a auditoria seguinte julga o mesmo intervalo, porque uma run interrompida não conta como auditada. Uma resposta do GitHub sem a hora do merge, ou, numa PR sob a regra de revisão, sem a head, as revisões ou as threads, também para o `Julgar`. Uma página incompleta do GitHub não interrompe nada: vira um commit fora do loop (acima).
- **O que ela não vê.** Um push direto que muda ou apaga o `main-audit.yml` é julgado pela cópia que ele deixou, e as auditorias seguintes, a diária inclusive, rodam essa mesma cópia até alguém restaurá-la pelo loop. E um force-push cujo topo antigo nem o GitHub conhece mais (404 no compare) não é nomeado como reescrita: a auditoria seguinte começa do `before` do push, ou da linha de base no agendamento e à mão ([ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md)). O GitHub também não guarda quando uma thread foi resolvida: a auditoria julga as threads como estão na hora dela, segundos depois do push do merge, e uma thread apagada não existe para ela.

Uma issue da auditoria é um relato, não um plano: o commit já está em `main`. O dono a tria e escolhe um de dois caminhos:

- **Registrar retroativamente.** Ligar a mudança a uma issue que explique o porquê, citar o commit nela e fechar a issue da auditoria com o link.
- **Reverter.** Fazer a reversão pelo loop, numa issue com plano e Approve, e fechar a issue da auditoria com o link da PR.

Se a issue diz que um check estava em andamento no merge, abra o log da run em andamento e veja o que a deixou vermelha. Se só o `issue-open` falhou, porque ela leu a issue já fechada pelo próprio merge, e a última run concluída antes do merge era `SUCCESS`, o check estava verde no merge: registre retroativamente, como na #46. Se ela ficou vermelha por outro passo, o merge atropelou um veredito novo, e o caminho é o de qualquer merge fora do loop.

Se a issue chama de "commit direto em main, sem PR" o merge de uma PR que fecha issue, é um falso positivo: mesmo depois das 3 tentativas, o GitHub ainda não tinha ligado o merge à PR. O dono fecha essa issue citando a PR. Mover a label de estado de uma issue da auditoria é do dono, como em qualquer issue.

## Os hooks do Claude Code

Desde a #5, hooks de projeto em `.claude/hooks/`, ligados pelo `.claude/settings.json`, interrompem o agente antes da ação, em toda sessão do Claude Code aberta neste repositório. Eles leem os contratos de `scripts/loop-sections.mjs`, os mesmos do gate e da auditoria, e são a camada 3 da [ADR 0002](../../context/decisions/0002-soft-enforcement-on-github-free.md).

| Hook | Quando roda | O que faz |
| --- | --- | --- |
| `guard-bash` | Antes de `Bash`, `Monitor` e `mcp__terminal__run_in_terminal` | Nega um comentário que abre como Approve, retirada ou título quase-Approve; `ready-for-agent` e qualquer outra escrita de label de estado, menos a troca de `needs-triage` por `ready-for-human` numa issue em `needs-triage` cujo último comentário abre com `# Plano`; `gh pr create` sem `Closes #N.` na primeira linha ou fora de uma branch de issue; commit e push em `main`; `gh issue reopen` e `gh repo edit`; os tokens de skip e o trailer `skip-checks: true`; resolver uma thread cujo último comentário não é de quem resolve. Pede confirmação antes de `gh pr merge` (e nega quando os checks exigidos, a revisão do Copilot na cabeça, os pedidos pendentes ou as threads, lidos ao vivo, não estão em ordem), de editar o corpo da issue ou um comentário, de uma indireção que cita o loop e de uma escrita pelo shell num caminho do harness. Dá às escritas do `git` no worktree (`checkout` e `restore` de caminhos, `reset --hard`, `apply`, `merge`, `pull`, `rebase`, `stash pop` e as demais) a mesma decisão do `build-guard` para uma edição |
| `build-guard` | Antes de `Edit`, `Write` e `NotebookEdit` | Deixa escrever fora de `context/intent/` só com o cache do gate aberto para a branch. Em `main`, nega tudo. Com um plano pendente, ou num caminho do harness, pede confirmação |
| `plan-to-issue` | Depois de `ExitPlanMode`, `Bash`, `Monitor` e `mcp__terminal__run_in_terminal` | Marca o plano aceito no plan mode como pendente, no diretório git comum do repositório, até ele ser publicado numa issue. Pelo `Monitor` e pelo terminal, a publicação só conta com a URL na saída ou confirmada ao vivo no GitHub. Ao publicar, apaga o cache do gate de cada worktree do repositório, que precisa rodar de novo, e depois o marcador |
| `session-context` | No início da sessão e a cada mensagem | Diz a branch, a issue e o estado do gate, e lembra que aprovação no chat não é Approve |

- **Valem assim que o `.claude/settings.json` muda.** O Claude Code recarrega o arquivo sem reiniciar a sessão (medido na #5).
- **Só restringem.** Nenhum hook devolve `allow`: sem objeção, o fluxo normal de permissão segue. Na dúvida, pedem confirmação.
- **Cada execução tem um prazo** (`.claude/hooks/lib/budget.mjs`), bem abaixo do `timeout` do hook no `.claude/settings.json`: passado o prazo, o hook pede confirmação crítica, em vez de o Claude Code matá-lo e deixar a ação seguir sem decisão.
- **Em `bypassPermissions`, `dontAsk` e `auto`,** uma confirmação crítica (merge, caminho do harness, cache não verificado, plano pendente, indireção, programa que o hook não consegue nomear, `gh pr create --web`, prazo esgotado, e todo valor que o hook não lê numa regra que nega) vira negação. Por isso, nesses modos, a mensagem, o corpo, o título e as labels vão literais, num heredoc ou em `"$(cat <<'EOF' … EOF)"`. Nesses casos, a ação é feita fora desse modo.
- **Quando um hook nega ou pede confirmação,** a mensagem diz o motivo. O agente resolve a causa (roda o gate, publica o plano, responde na thread) em vez de contornar o hook.
- **Os limites** estão na ADR 0002: os hooks param o agente, não o dono; não leem um programa rodado a partir de um arquivo; só valem nas sessões do Claude Code deste projeto; e o que só acontece com evasão deliberada fica de fora, pelo critério do agente cooperativo.

## Saída de emergência do dono

O dono pode desligar os hooks do Claude Code (#5) na própria máquina com `"disableAllHooks": true` em `.claude/settings.local.json`, que não é versionado. É um ato do dono: o agente nunca escreve esse arquivo. Desligar os hooks não desliga o gate nem o CI.

## Onde vai um documento novo

| Você está escrevendo | Vai em |
| --- | --- |
| Um plano | Uma issue, nunca um arquivo |
| O que o mock precisa fazer, com critérios de aceite | `context/intent/` |
| Uma escolha relevante e os motivos | `context/decisions/` |
| Uma regra que a revisão confere | `context/knowledge/patterns/` |
| Um erro a não repetir | `context/knowledge/anti-patterns/` (o primeiro chegou com a #2, e a #4 trouxe os do histórico) |
| Uma tarefa repetível para um agente de IA | `context/agents/agent-<nome>.md` (a pasta chega com o primeiro agente) |
| Uma definição | [`context/knowledge/glossary.md`](../../context/knowledge/glossary.md) |
| O que mudou e o que ensinou | O [changelog](../../context/evolution/changelog.md), no passo Learn |
| Como rodar, mudar ou operar algo | `docs/` |

Cada tipo de arquivo de contexto tem o template e os status possíveis no [guia do Context Mesh](../../context/README.md).
