# Bug: A auditoria chama de check vermelho um check em andamento no merge

## Descrição

- **Esperado.** Quando um check exigido ainda rodava no merge, a issue da auditoria diz isso e dá o último resultado concluído antes do merge, para o dono triar sem abrir as tentativas da run.
- **Atual.** A auditoria escreve `PR #P mergeada sem <workflow / job> verde`, o mesmo motivo de uma PR mergeada com o check vermelho. Foi o que aconteceu com o merge da PR #43 (`e28f918`), registrado na #46. No merge, às 10:05:51Z, a cabeça `17f1dbd` tinha o `issue-link` verde nas tentativas 1 e 2 da run 36407495291, concluídas às 10:04:59 e às 10:05:27. A tentativa 3 começou às 10:05:42 e terminou vermelha às 10:05:59, com `issue-open: #35 está fechada`: ela leu a issue fechada pelo próprio merge. A #46 só foi fechada depois de conferir as tentativas à mão.
- **Reprodução.** O caso `issue-link still running when the PR merged` de `test/scripts/audit-main.spec.ts` monta uma run que começa antes do merge e termina depois, e a auditoria dá o mesmo motivo de uma run vermelha. Os testes desta issue montam o caso da #43 e esperam o motivo novo.

## Causa raiz

- **A auditoria já julga no horário do merge.** O `greenAtMerge` de `scripts/audit-main.mjs` pega, entre as runs do job que começaram até o `mergedAt`, a que começou por último, e exige que ela tenha terminado com `SUCCESS` até o merge. O relato dizia que a auditoria lia o check como ele estava na hora de auditar, e isso não se confirmou.
- **Uma run em andamento no merge conta como não verde, de propósito.** Ela é o veredito mais novo, ainda sem resultado. O defeito é que o motivo não separa esse caso de uma run vermelha.
- **O merge da #43 foi feito com uma re-execução em andamento.** O refresh re-executava o `issue-link` a cada sinal de revisão, o que saiu com a #30, e ainda o re-executa a cada evento na issue. O hook de merge da #5, que veio depois da #43, nega o `gh pr merge` com um check exigido em andamento, mas o fluxo não pedia o mesmo para um merge feito à mão.

## Abordagem da correção

- **A regra fica, e o motivo passa a nomear o caso.** O merge com um check exigido em andamento continua fora do loop, com `PR #P mergeada com <workflow / job> em andamento; a última run concluída antes do merge: <conclusão | nenhuma>`. Uma run vermelha concluída antes do merge, uma verde só depois dele e a falta de run continuam com o motivo de hoje.
- **O fluxo pede o que o hook confere.** Antes de todo merge, também o feito à mão, nenhuma run do `issue-link` nem do `Qualidade / check` na fila ou em andamento na cabeça. A triagem diz como ler o motivo novo.
- **Os testes.** `test/scripts/audit-main.spec.ts` ganha o caso da #43 e muda o do check em andamento para o motivo novo. `test/scripts/drift.spec.ts` confere o motivo novo no fluxo e na ADR 0002.

O plano vigente e o Approve do dono estão na #48. O dono aprovou as três recomendações: manter a regra e nomear o caso, pôr no motivo a conclusão da última run concluída, e criar um anti-pattern para o merge com uma run em andamento. A branch é `fix/48-auditoria-check-em-andamento`, cortada de `origin/main` em `22059b6`.

## Critérios de aceite

- [x] Uma PR cuja última run de um check exigido começou antes do merge e ainda não tinha concluído nele fica fora do loop com o motivo `PR #P mergeada com <workflow / job> em andamento; a última run concluída antes do merge: <conclusão | nenhuma>`. Um teste com o caso da #43 falha antes da correção e passa depois.
- [x] Uma run vermelha concluída antes do merge, uma verde só depois dele e a falta de run continuam com `PR #P mergeada sem <workflow / job> verde`. Uma run que começa depois do merge continua sem contar.
- [x] O fluxo pede, para todo merge, que nenhuma run do `issue-link` nem do `Qualidade / check` esteja na fila ou em andamento na cabeça, e diz como triar o motivo novo.
- [x] O fluxo e a ADR 0002 citam o motivo novo como a auditoria o escreve, e o `drift.spec.ts` confere isso.
- [x] O intent do bug, a ADR 0002, o anti-pattern novo, o `CODING_STANDARDS.md` e o changelog registram a correção. `npm run check`, o e2e e o gate passam.

## Decisões relacionadas

- [ADR 0002: Enforcement soft do loop no GitHub Free](../decisions/0002-soft-enforcement-on-github-free.md)
- [ADR 0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Resultados

Os commits seguem os passos do plano: o intent (`6cf8c6c`), os testes que falham (`e199897`), a correção (`b8b9c0b`), as docs (`b4afda7`) e este Learn.

- **Antes da correção**, em `e199897`, os 5 casos novos de `test/scripts/audit-main.spec.ts` falharam: a auditoria escrevia `- PR #11 mergeada sem Vínculo com issue / issue-link verde.` onde o teste esperava o motivo do check em andamento. Os 2 casos novos do `drift.spec.ts` falharam até as docs. O caso do run enfileirado, sem `startedAt`, já passava e continua passando: ele não conta, e o hook de merge o recusa.
- **Depois**, os 25 testes de `required checks` passam, os 188 do `audit-main.spec.ts` também, e os 206 do `drift.spec.ts`.
- **O que entrou.** O `greenAtMerge` virou `checkAtMerge`, que devolve `green`, `inFlight` e `lastConcluded`, e o `judgePull` escreve o motivo do check em andamento. O caso antigo `issue-link still running when the PR merged` foi para a tabela nova, com o motivo novo. Na tabela do `sem verde` entrou um caso com duas runs começadas juntas antes do merge, uma vermelha concluída e outra em andamento: o vermelho concluído vence.
- **As mutações**, numa cópia da árvore fora do git, cada uma pega pelos testes de `required checks`:

  | Mutação | Falhas |
  | --- | ---: |
  | `inFlight` sempre falso | 5 |
  | A última conclusão sempre `nenhuma` | 4 |
  | "Em andamento" na frente de um vermelho concluído | 1 |
  | Contar uma run que começou depois do merge | 2 |

- **Onde se afastou do plano.**
  - A seção do merge no fluxo ganhou o comando que confere o que o hook confere: `gh pr checks <n>` sem nenhum `pending`.
  - O `workflow.md` não passa no Prettier, mas isso já acontecia em `main`, e `docs/` fica fora do `format:check`.
- **O Build pediu o dono presente.** No modo automático, o hook negou a edição de `scripts/audit-main.mjs`. A sessão saiu do modo automático, e cada edição no harness passou pela confirmação do dono.

## Status

- **Criado**: 2026-09-29 (Fase: Intent), do plano aprovado na issue #48 (#48)
- **Status**: Resolved
- **Atualizado**: 2026-09-29 (Fase: Learn), critérios cumpridos na branch `fix/48-auditoria-check-em-andamento`, com os Resultados, a ADR 0002 e o anti-pattern novo (#48)
