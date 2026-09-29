# Anti-pattern: Mergear com uma re-execução do check em andamento

## Resumo

Mergear uma PR enquanto uma run de um check exigido ainda está na fila ou em andamento na cabeça. O verde que se viu é o de uma run anterior, e a run em andamento é o veredito mais novo, ainda sem resultado. Se ela lê o estado depois do merge, julga a PR no meio dele.

## Problema

No merge da PR #43 (`e28f918`), às 10:05:51Z, o `issue-link` da cabeça `17f1dbd` estava verde nas tentativas 1 e 2 da run 36407495291. A tentativa 3, disparada pelo refresh às 10:05:42, ainda rodava. Ela terminou vermelha às 10:05:59 com `issue-open: #35 está fechada`: leu a issue já fechada pelo próprio merge.

A auditoria de `main` registrou o merge na #46 como `mergeada sem Vínculo com issue / issue-link verde`. Ela estava certa em deixá-lo fora do loop: no merge, o veredito mais novo não tinha resultado. A triagem, porém, precisou abrir as tentativas à mão para separar esse caso de um merge vermelho de verdade.

Uma re-execução em andamento pode vir de um evento que muda o veredito: um Approve retirado, uma label movida, um `# Plano` novo. Mergear no meio dela atropela esse veredito.

## O que fazer em vez disso

- **Antes de todo merge, nenhum check exigido na fila ou em andamento na cabeça.** `gh pr checks <n>` sem nenhum `pending`, logo depois do veredito fresco ([o fluxo](../../../docs/development/workflow.md#pull-requests-e-merge)). O hook de `gh pr merge` (#5) nega o merge nesse caso, mas só para o agente. O merge pela web depende de quem mergeia.
- **Se uma run começou, espere ela terminar.** Um verde anterior não vale mais do que o resultado que está por vir.
- **Na triagem, leia o motivo da auditoria.** Desde a #48, ela escreve `mergeada com <workflow / job> em andamento; a última run concluída antes do merge: <conclusão>`. O log da run em andamento diz o que a deixou vermelha. Se foi só o `issue-open` da issue fechada pelo merge, o registro retroativo basta.

## Exemplo do erro

```text
10:04:59  issue-link, tentativa 1: verde
10:05:27  issue-link, tentativa 2: verde (refresh)
10:05:42  issue-link, tentativa 3: começa (refresh)
10:05:51  merge da PR #43                    <- com a tentativa 3 em andamento
10:05:59  tentativa 3: vermelha, issue-open: #35 está fechada
          auditoria: PR #43 fora do loop (#46)
```

## Status

- **Criado**: 2026-09-29 (Fase: Learn), do merge da PR #43, registrado na #46 e corrigido na auditoria pela #48 (#48)
- **Status**: Active
