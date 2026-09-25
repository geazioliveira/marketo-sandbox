# ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge

## Contexto

- Em 2026-09-25, o dono pediu, na #13: **"para dar merge precisamos adicionar no gate que os comentários do copilot precisam existir e precisam estar verdes também, não podemos ter comentários abertos ou não resolvidos"**.
- As PRs #10 e #11 mostram por quê. As duas foram mergeadas antes de a revisão do Copilot chegar:

  | | PR #10 | PR #11 |
  | --- | --- | --- |
  | PR aberta | 00:43:45Z | 04:40:29Z |
  | Mergeada | 00:46:02Z | 04:43:52Z |
  | Revisão do Copilot | 00:49:47Z, em `d00f43b` | 04:46:53Z, em `7328ecb` |
  | Cabeça da PR no merge | `25b5939` | `0a0261c` |
  | Threads abertas depois do merge | 4 | 3 |

  A revisão chegou depois do merge e cobriu um commit que não era a cabeça. As 7 threads ficaram abertas até a #12. Ninguém as respondeu, porque o monitor de CI do app (auto-fix e comentários) não vem ligado nas PRs que o agente abre.
- **Como o Copilot revisa aqui.** A revisão automática vem da configuração pessoal do dono, não do repositório: rulesets não existem no plano Free (HTTP 403, [ADR 0002](0002-soft-enforcement-on-github-free.md)). O pedido chega 1 s depois de a PR abrir, ou quando ela sai de draft. A revisão roda como uma run do Actions ("Running Copilot Code Review") e leva uns 6 min. Por padrão, o estado dela é sempre `COMMENTED`. `APPROVED` é preview e exige uma opção própria. Por padrão o Copilot revisa uma vez só; a opção "Review new pushes" da configuração do dono faz ele revisar de novo a cada push. Na PR #14, a primeira revisão cobriu `53938d6`. Depois do push de `2f02ce0`, o Copilot foi pedido de novo às 13:55:01Z, a revisão da cabeça chegou às 14:00:20Z, e o merge veio às 14:01:35Z, com as 3 threads resolvidas.
- **Quem é o Copilot.** No GraphQL, o autor da revisão é `Bot` `copilot-pull-request-reviewer`, com `databaseId` 175728472. No REST, o mesmo bot se chama `copilot-pull-request-reviewer[bot]` numa revisão e `Copilot` num comentário. E `GET users/copilot-pull-request-reviewer` devolve uma organização: o login sozinho não identifica o bot.
- **O que o GitHub mostra e o que ele não mostra.**
  - Uma revisão tem o estado e o commit que ela cobriu (`commit.oid`).
  - Uma revisão que falhou também chega como `COMMENTED`, do bot, no commit da cabeça: só o começo do corpo diz que o Copilot não revisou nada. Corpos medidos no GitHub: "Copilot encountered an error and was unable to review this pull request…" (keycloak/keycloak#52793), "Copilot wasn't able to review any files in this pull request." (Azure/azure-powershell#30106) e, quando a cota, a cobrança ou a elegibilidade de quem pediu falha, "Copilot was unable to review this pull request because…" (bsv-blockchain/teranode#1697, onnx/onnx#8217). Esse último importa aqui: quando a cota de Copilot do dono acabar, a revisão falha, e sem a regra o gate ficaria verde sem revisão nenhuma.
  - Cada resposta numa thread também é uma revisão `COMMENTED`, de quem responde: na PR #14, as 3 respostas do dono viraram 3 revisões.
  - Uma thread diz se está resolvida (`isResolved`) e se está desatualizada (`isOutdated`), mas não quando foi resolvida: não existe `resolvedAt`.
  - Uma revisão enviada ou dispensada dispara `pull_request_review`, que roda o YAML da própria PR.
  - Resolver ou reabrir uma thread não dispara workflow nenhum: `pull_request_review_thread` só existe como webhook.
  - O check run do Copilot também não dispara workflow nenhum.
  - Um achado que aparece só no resumo da revisão, sem thread, vem num HTML que não é documentado.
- **O que o agente consegue fazer, com o token do dono:**
  - pedir a revisão com `gh pr edit <n> --add-reviewer @copilot`;
  - responder numa thread com `addPullRequestReviewThreadReply`;
  - resolver uma thread com `resolveReviewThread`, que, numa thread do Copilot, aceita o motivo `ADDRESSED`, `WONT_FIX` ou `INVALID`.

## Decisão

Uma PR só é mergeada com uma revisão do Copilot no commit que é a cabeça dela e nenhuma thread de revisão aberta.

1. **Duas condições de merge, no gate.** O modo CI do gate ganha dois passos, logo depois de `pr-first-line`:
   - **`copilot-review`** exige uma revisão do Copilot no estado `COMMENTED` ou `APPROVED`, cujo `commit.oid` é o `headRefOid` da PR. Uma revisão de um commit anterior não conta, e uma revisão `DISMISSED`, `PENDING` ou `CHANGES_REQUESTED` também não. Uma revisão que falhou também não conta: o gate a reconhece pelo começo do corpo (`copilotFailedReview`), e as duas falhas medidas bloqueiam, "any files" inclusive, porque não há bypass (item 6). O gate lê as 100 revisões mais recentes: uma que conta entre elas basta, porque as mais antigas não a desfazem; sem nenhuma entre elas, numa PR com mais revisões do que isso, o passo fica não conferido e bloqueia, como na auditoria.
   - **`review-threads`** exige nenhuma thread de revisão não resolvida. Contam as threads de qualquer autor (o Copilot, o dono ou outra pessoa), inclusive as desatualizadas.

   Os dois bloqueiam no CI, fora de draft. Numa PR em draft, que não pode ser mergeada, eles só relatam. No terminal, onde o gate não lê a PR, dizem "só no modo CI". Uma página de threads que o gate não leu inteira fica não conferida e bloqueia. Quando um dos dois dá não, a mensagem termina com o jeito de renovar o veredito: o gate em modo CI na cabeça da PR. O [gate do loop](../knowledge/patterns/loop-gate.md#a-revisão-do-copilot-e-as-threads) dá as regras e as mensagens.
2. **O Copilot é casado pelo tipo e pelo `databaseId`.** O autor precisa ser `Bot` com `databaseId` 175728472. O login legível (`copilot-pull-request-reviewer`) só aparece nas mensagens, e o login de pedido (`copilot-pull-request-reviewer[bot]`) só serve para pedir a revisão pelo REST ou pelo GraphQL.
3. **Uma fonte só.** Os contratos ficam em `scripts/loop-sections.mjs`:
   - `copilotReviewer`, `copilotRequestLogin`, `copilotReviewStates` e `copilotFailedReview`;
   - `reviewRuleSince`, a data a partir da qual a auditoria aplica a regra;
   - as funções puras `copilotReviewOn` e `openThreads`;
   - os comandos `copilotRequestCommand`, `refreshPrCommand` e `gateCiCommand`.

   O gate, a auditoria e os testes leem dali, e os hooks da #5 vão ler dali quando existirem.
4. **O re-disparo tem duas etapas.** O `issue-link` só roda com eventos da PR, e uma revisão não é um deles.
   - **O sinal.** O `.github/workflows/review-signal.yml` (workflow `Sinal de revisão`) roda em `pull_request_review` (`submitted`, `dismissed`). Ele roda o YAML da própria PR, então tem `permissions: {}`, não faz checkout e só imprime o número da PR.
   - **O refresh.** O `issue-link-refresh.yml` roda de `main` e responde ao `workflow_run` do sinal, e só quando a run do sinal terminou com `success`. Ele também aceita um `workflow_dispatch` com o número da PR, disparado de `main` (`gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`), que sozinho não é veredito fresco. Um `workflow_dispatch` roda o YAML e o script da ref em que foi disparado, então o job pula um disparo de outra ref; isso só pega acidentes, porque a cópia dessa ref pode tirar a guarda.
   - **O modo PR do `scripts/refresh-issue-link.mjs`.** Ele lê a PR de novo, pula a que não está mais aberta, e re-executa a run mais recente do `issue-link` da cabeça dela, a do evento `pull_request_target`.
5. **A auditoria de `main` aplica a regra a partir de `2026-09-25T12:00:00Z` (`reviewRuleSince`).** Um merge desde então fica fora do loop em dois casos:
   - não houve, até o merge, uma revisão do Copilot na cabeça da PR (uma revisão que falhou não conta);
   - uma thread aberta até o merge continua não resolvida na hora da auditoria.

   As PRs #10 e #11 foram mergeadas antes dessa data, e as threads delas foram tratadas na #12. A PR #14, que fechou a #12, já seguiu a regra.
6. **Não há bypass.** Se o Copilot estiver indisponível, a PR espera. Se o dono mergear mesmo assim, a auditoria registra o merge, como qualquer outro desvio ([ADR 0002](0002-soft-enforcement-on-github-free.md)).
7. **Um achado só no resumo fica fora do gate.** O gate não o lê, porque o formato do resumo não é documentado: do corpo, ele só lê o começo, para reconhecer uma revisão que falhou. O agente o trata na PR, com a mesma resposta que daria numa thread.
8. **O que o agente faz em cada PR:**
   1. abre a PR em draft (`gh pr create --draft`);
   2. logo depois do `gh pr create`, liga na PR o monitor de CI do app, com auto-fix e comentários;
   3. tira a PR de draft (`gh pr ready`) só com o Learn commitado. Sair de draft pede a revisão do Copilot, que assim cobre a cabeça final;
   4. depois de cada push, lê a timeline da PR (`gh api repos/geazioliveira/marketo-sandbox/issues/<n>/timeline`). Se ela não mostra um `review_requested` do Copilot depois da hora do push e nenhuma revisão do Copilot chega na cabeça nova em uns 10 min, pede a revisão de novo com `gh pr edit <n> --add-reviewer @copilot`. O agente não vê se "Review new pushes" está ligado na configuração do dono, então confere em vez de supor. Uma revisão que falhou também pede a revisão de novo;
   5. responde em cada thread antes de resolvê-la. A resposta traz o SHA da correção (`ADDRESSED`), uma issue `#N` que fica com o achado (`WONT_FIX`) ou a evidência de que ele não procede (`INVALID`). Os hooks da #5 vão fazer isso valer; até lá é regra escrita;
   6. depois de resolver, atualiza o check com `gh workflow run issue-link-refresh.yml --ref main -f pr=<n>`, porque resolver uma thread não dispara nada; esse disparo sozinho não é veredito fresco, porque o comando volta antes de o refresh rodar e um refresh que falha não aparece na PR;
   7. logo antes do merge, tira um veredito fresco: o gate em modo CI na cabeça da PR (`node scripts/gate.mjs --pr <n> --branch <branch>`), com saída 0, ou o `issue-link` da PR re-rodado (`gh run rerun <run-id>`) e acompanhado até o fim com `gh run watch <run-id> --exit-status`.

## Racional

- **Na cabeça exata.** Uma revisão de um commit anterior deixa sem revisão o código empurrado depois dela. Nas PRs #10 e #11, a revisão cobriu um commit que não era a cabeça.
- **O tipo e o `databaseId`, não o login.** Uma organização tem esse login, e o REST escreve o nome do bot de dois jeitos. Um `Bot` com esse `databaseId` só pode ser o app do Copilot.
- **`COMMENTED` conta.** É o único estado que o Copilot deixa por padrão. Exigir `APPROVED` travaria todo merge.
- **Uma revisão que falhou não conta.** Ela chega `COMMENTED`, do bot e na cabeça, mas não revisou nada. Contá-la deixaria uma queda do Copilot abrir o merge, que é o bypass que o item 6 recusa.
- **O veredito fresco é o gate ou um rerun acompanhado.** O `gh workflow run` volta antes de o refresh rodar, e um refresh que falha não aparece na PR: esperar o check logo depois do disparo mostra o veredito velho como se fosse novo.
- **Threads de qualquer autor, inclusive as desatualizadas.** O dono pediu "não podemos ter comentários abertos ou não resolvidos", sem distinguir o autor. Uma thread desatualizada só diz que as linhas mudaram, não que o achado foi tratado, e fechá-la custa uma resposta.
- **No `issue-link`, e não num check novo.** O `issue-link` já é um check exigido, vem de `main` e é o que a auditoria confere. Um check novo precisaria de um nome novo na regra de merge e na auditoria, e seria mais um workflow para a PR afrouxar.
- **Duas etapas.** O YAML de um evento de revisão vem da PR, e uma PR pode dar escrita ao próprio token. O sinal não tem permissão nenhuma e não julga nada. Quem re-executa o `issue-link` roda de `main`, como o gate: é o mesmo princípio da [ADR 0002](0002-soft-enforcement-on-github-free.md).
- **A auditoria a partir de uma data.** As PRs #10 e #11 foram mergeadas antes de a regra existir, e a #12 tratou as threads delas. Julgá-las pela regra nova abriria issues para um desvio que já foi tratado. A data também deixa estável o julgamento de um merge antigo, se a auditoria recomeçar da linha de base.
- **As threads, na hora da auditoria.** Sem `resolvedAt`, ninguém sabe se uma thread estava resolvida no merge. A auditoria roda segundos depois do push do merge, então o que ela vê é quase o estado do merge.
- **Nenhum bypass.** O agente posta com a conta do dono, então um bypass escrito pelo agente seria igual a um do dono. Sem bypass, o único jeito de mergear sem a revisão é o dono mergear, e a auditoria registra isso.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Qualquer revisão do Copilot desde a abertura da PR | É mais barata, mas o código empurrado depois da revisão fica sem revisão |
| Exigir `APPROVED` | É preview, exige uma opção que pode não existir num repositório pessoal privado, e o Copilot deixa só `COMMENTED` por padrão: travaria todo merge |
| Re-disparo numa etapa só, em `pull_request_review` | O YAML roda da própria PR, que poderia afrouxá-lo ou dar escrita ao token. Aqui, o que afeta o veredito vem de `main` |
| Só renovação manual | Cada revisão deixaria o `issue-link` com o veredito velho até alguém lembrar de renová-lo. O sinal custa pouco runner e poupa esse passo |
| Só o dono resolve as threads | Custa um clique do dono por thread. Uma resposta com o SHA, a issue ou a evidência antes de resolver deixa o mesmo registro, e os hooks da #5 vão fazer isso valer; até lá é regra escrita |
| Casar o Copilot pelo login | Uma organização tem esse login, e o REST escreve o nome do bot de dois jeitos |

## Consequências

- **Mais fácil**:
  - nenhum merge acontece antes de o Copilot revisar a cabeça;
  - uma thread aberta aparece na saída do gate, com `path:line` e o link;
  - um merge sem a revisão ou com thread aberta vira uma issue da auditoria;
  - os hooks da #5 vão encontrar os contratos prontos em `scripts/loop-sections.mjs`.
- **Mais difícil**:
  - todo push depois da revisão pede uma revisão nova, e cada uma leva uns 6 min;
  - cada revisão gasta crédito de IA do Copilot e minutos de runner, o do Copilot, o do sinal e o do refresh;
  - cada resposta numa thread também é uma revisão enviada e dispara o sinal: uma run do sinal e uma do refresh por resposta;
  - o gate reconhece uma revisão que falhou só pelos textos de falha que o contrato conhece (`copilotFailedReview`), ou por um corpo ausente, vazio ou só com espaços: um texto novo passaria como revisão até entrar no contrato;
  - cada thread pede uma resposta antes de ser resolvida, mesmo quando o achado não procede;
  - o Copilot pode repetir numa revisão nova um achado já resolvido, e o agente responde de novo, citando a thread anterior.
- O `issue-link` roda o gate de `main` ([ADR 0002](0002-soft-enforcement-on-github-free.md)), então os passos novos só valem depois do merge da #13. Até lá, o `issue-link` não os tem, e o `workflow_dispatch` do refresh também não existe. O `gh run rerun` do `issue-link` só confere os passos que `main` já tem, e o veredito fresco que confere os passos novos é o gate desta branch em modo CI, rodado localmente na cabeça da PR. Por isso a PR da #13 segue a regra à mão: espera a revisão do Copilot na cabeça, fecha as threads e mostra isso na "Verificação". A própria PR da #13 (#15) mediu a primeira coisa: a revisão do Copilot dispara `pull_request_review`, mas a run do sinal fica em `action_required`, porque o GitHub pede aprovação para uma run disparada por bot. Então, depois da revisão do Copilot, o veredito é sempre renovado à mão. A primeira PR depois do merge mede a segunda: se o `GITHUB_TOKEN` consegue re-executar uma run de `pull_request_target`.
- Um rerun reusa o SHA de `main` da run original. Uma PR aberta antes do merge da #13 continua julgada pelo gate antigo nos reruns, até um push novo.

## Relacionados

- [ADR 0002: Enforcement soft do loop no GitHub Free](0002-soft-enforcement-on-github-free.md), cujas camadas e limites ganharam o sinal de revisão, o modo PR do refresh e a regra de revisão da auditoria
- [ADR 0001: Context Mesh no repositório e loop issue-first](0001-context-mesh-in-the-repository.md)
- [Feature: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../intent/feature-review-gate.md)
- [Pattern: O gate do loop](../knowledge/patterns/loop-gate.md)
- [Pattern: Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)
- [O fluxo de desenvolvimento](../../docs/development/workflow.md#a-revisão-do-copilot-e-as-threads)
- As threads das PRs #10 e #11 (#12) e os hooks do Claude Code (#5)

## Status

- **Criado**: 2026-09-25 (Fase: Build), do pedido do dono na #13 (#13)
- **Status**: Accepted
