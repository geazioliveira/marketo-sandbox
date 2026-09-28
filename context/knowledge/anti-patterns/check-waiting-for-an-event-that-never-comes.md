# Anti-pattern: Check que espera um evento que não chega

## Resumo

Um check exigido que bloqueia por uma condição que chega depois da run dele, e que nenhum evento de workflow renova quando ela chega, nasce vermelho e fica vermelho até alguém re-rodá-lo à mão.

## Problema

Da #13 à #30, o `issue-link` bloqueava o merge sem uma revisão do Copilot na cabeça da PR e com uma thread de revisão aberta. As duas coisas mudam fora dos eventos que rodam o check:

- a revisão pedida chega de 2,5 a 22 min depois do pedido, bem depois da run do push;
- o sinal que devia re-disparar o check depois de uma revisão ficava em `action_required` quando quem revisava era o Copilot, porque o GitHub pede aprovação para uma run disparada por bot, e uma revisão sem comentários nem criava uma run;
- resolver uma thread não é evento de workflow nenhum.

O resultado, medido no plano da #30: 32 de 76 tentativas do `issue-link` vermelhas, todas no passo da revisão, e 4 das 5 PRs mergeadas sob a regra só ficaram verdes com um `gh run rerun` manual. Um check que vive vermelho ensina a ignorar o vermelho, que é o contrário do que ele existe para fazer.

## O que fazer em vez disso

- **Separe relatar de exigir.** O check que roda nos eventos da PR relata a condição que ainda vai chegar, com um aviso visível (uma annotation e o resumo do job), e fica verde no resto. Quem exige é o ponto em que a decisão acontece: aqui, o veredito fresco logo antes do merge, o hook de `gh pr merge` e a auditoria de `main` ([ADR 0003](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)).
- **Mantenha a opção de relatar fora do alcance da PR.** O `--review-report` vive no `issue-link.yml`, que o `pull_request_target` lê de `main`, e um teste fixa que o comando do veredito fresco nunca a passa.
- **Antes de apostar num re-disparo, meça se o evento chega.** O sinal de revisão foi desenhado sem medir o caso do Copilot; a medição na PR #15 mostrou o `action_required`, e o check ficou vermelho por semanas antes da #30.

## Exemplo do erro

```text
push na PR       -> issue-link roda: copilot-review [ ] (a revisão ainda não chegou)  -> vermelho
revisão chega    -> Sinal de revisão: action_required (disparado por bot)            -> nada re-roda
thread resolvida -> nenhum evento                                                     -> nada re-roda
merge            -> só depois de um gh run rerun à mão
```

## Status

- **Criado**: 2026-09-28 (Fase: Learn), da #30, que fez o `issue-link` só relatar a revisão do Copilot e as threads (#30)
- **Status**: Active
