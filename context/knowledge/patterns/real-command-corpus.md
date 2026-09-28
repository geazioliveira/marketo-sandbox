# Pattern: Corpus de comandos reais

## Resumo

Uma guarda que decide sobre comandos é conferida contra os comandos que o trabalho real rodou, não só contra os casos que o autor imaginou.

## Problema

Os testes de uma guarda nascem das regras: um caso por regra, e os vizinhos que a regra recusa. Isso prova que a guarda nega o que deve, mas não que ela deixa passar o trabalho de todo dia.

Na #5, os hooks do Claude Code passavam em cerca de 1.000 testes e numa revisão adversarial por peça. Rodados sobre 902 comandos Bash reais das sessões deste projeto, eles pediram confirmação em 75, e a maioria era trabalho legítimo:

- uma variável atribuída na própria linha (`SP=…; gh issue comment 8 --body-file "$SP/plano.md"`) não era lida;
- um programa Python que só editava documentação citando `needs-triage` disparava a tripwire;
- a origem de um `cp` contava como escrita.

Em modo `auto`, uma confirmação crítica vira negação: esses falsos positivos teriam travado o trabalho.

## Solução

- **Junte o corpus dos transcripts.** Os comandos que as ferramentas receberam estão nos `.jsonl` das sessões do projeto (`~/.claude/projects/<projeto>/*.jsonl`). Tire os únicos.
- **Rode a guarda como processo, sem rodar o comando.** Cada comando vira a entrada JSON do hook, e só a decisão é lida.
- **Classifique cada recusa e cada confirmação.** Uma recusa certa fica (um merge de PR já mergeada, uma label numa issue que mudou de estado). Um falso positivo vira correção, com um teste.
- **Guarde o resultado como linha de base.** Depois de cada mudança, o corpus roda de novo, e toda decisão que mudou é explicada. Na #5: 816, 75 e 11 (passa, confirma, nega) viraram 847, 44 e 11, com as mesmas 11 recusas.
- **Meça o tempo junto.** Um hook que estoura o tempo falha aberto. Na #5, a mediana ficou em 93 ms e o máximo em 1,5 s.

## Quando usar

- Antes de ligar uma guarda que decide sobre comandos, caminhos ou textos que as pessoas e os agentes já produzem: hooks, lint de mensagens, validação de corpos.
- Depois de toda mudança na guarda que possa mudar o que passa.

## Quando NÃO usar

- Para provar que a guarda nega o que deve: isso é trabalho dos testes por regra e da revisão adversarial. O corpus mostra o custo da guarda, não a força dela.
- Com comandos que ainda dependem de estado vivo sem aviso: uma recusa que depende do GitHub (o estado de uma issue, de uma PR) muda com o tempo e precisa ser lida assim.

## Decisões relacionadas

- [0002: Enforcement soft do loop no GitHub Free](../../decisions/0002-soft-enforcement-on-github-free.md)

## Status

- **Criado**: 2026-09-26 (Fase: Learn), da validação dos hooks da #5 contra os comandos reais das sessões (#5)
- **Status**: Active
