# Anti-pattern: Uma PR que prende partes independentes

## Resumo

Uma PR que junta peças que se revisam, se corrigem e se mergeiam sozinhas faz cada achado numa peça segurar o merge de todas as outras, e cada rodada de revisão relê o conjunto inteiro.

## Problema

A PR #26, da #5, trouxe numa branch só os quatro hooks do Claude Code e a biblioteca deles:

- **O tamanho.** Eram 11 módulos em `.claude/hooks/`, com cerca de 14 mil linhas de código e 19 mil de testes e suporte. Os módulos são independentes até o `.claude/settings.json` registrá-los: cada um se revisa e se testa sozinho.
- **As rodadas.** O Copilot revisou a cabeça da PR dez vezes, com 6, 6, 11, 4, 5, 3, 2, 1, 1 e 2 achados. Cada rodada levou de uma a duas horas entre corrigir com teste, verificar, fazer o Learn, o push e pedir nova revisão ([ADR 0003](../../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)).
- **Um achado segurava tudo.** Um achado no `plan-to-issue` segurava o merge do `build-guard`, do `session-context` e das docs, que já estavam prontos.
- **`main` andou por baixo.** Três outras PRs (#6, #8 e #7) mergearam durante a #26, e cada uma trouxe um conflito para resolver nela.
- **O fim.** O dono fechou a PR em 2026-09-27 e pediu a #5 de volta como uma stack de PRs pequenas, o que o loop só passou a aceitar com a #31.

## O que fazer em vez disso

- **Quebrar pela dependência entre as peças.** Uma fatia por peça que se revisa sozinha, na ordem em que uma depende da outra, com a que liga tudo por último. Cada fatia fica inerte até a última e pode ser mergeada sem risco ([Stack de PRs](../../../docs/development/workflow.md#stack-de-prs)).
- **Uma sub-issue por fatia, com o Approve da mãe.** O plano da mãe declara a stack e é aprovado uma vez ([ciclo de vida de issue e branch](../patterns/issue-branch-lifecycle.md#numa-stack)).
- **Olhar o tamanho antes de abrir a PR.** O passo `pr-size` do `issue-link` relata as linhas alteradas contra a base, com 1.500 como referência ([o gate do loop](../patterns/loop-gate.md)).
- **Combinar antes quando um achado vira correção e quando vira limite.** Na #26, cada achado virou correção com teste, e os achados foram ficando mais exóticos a cada rodada. Um critério combinado no plano limita o trabalho de cada rodada.

## Exemplo do erro

```text
PR #26  feature/5-hooks-claude-code
  revisões do Copilot: 10, achados: 6, 6, 11, 4, 5, 3, 2, 1, 1, 2
  conflitos com main: 3 (#6, #8, #7)
  fechada em 2026-09-27, sem merge
```

## Status

- **Criado**: 2026-09-27 (Fase: Learn), das rodadas de revisão da PR #26, que levaram à #31 (#31)
- **Status**: Active
