# Anti-pattern: Guarda que só reconhece o nome literal

## Resumo

Uma guarda que protege um arquivo só quando o comando escreve o nome dele deixa passar o mesmo arquivo alcançado por um padrão, por um diretório inteiro ou por um programa que o encontra sozinho.

## Problema

Na #5, o `guard-bash` negava escrever em `loop-gate.json`, no marcador do plano pendente e em `.claude/settings.local.json` quando o nome aparecia na linha. A revisão adversarial provou que o mesmo efeito passava por outros caminhos:

- `rsync --remove-source-files`, com o arquivo ou o diretório git como origem: a origem não contava como escrita;
- `find .git -name 'loop-*' -delete` e `find … -exec rm {} +`: o `find` não contava como escrita, e o `{}` era um nome desconhecido;
- `rm -f .git/loop-*`: o padrão não era o nome.

Em cada caso, o arquivo que a guarda existe para proteger era removido sem que ela visse.

## O que fazer em vez disso

- **Julgue também pelo lugar.** Proteja o diretório que guarda os arquivos, não só os nomes deles. Na #5:
  - mexer no diretório git inteiro, ou num padrão dentro dele, é negado;
  - uma escrita dentro dele, ou num diretório que o contém, pede confirmação crítica;
  - um diretório que contém `.claude/settings.local.json` é negado.
- **Conte o que cada programa escreve de fato.** A origem que `mv` e `rsync --remove-source-files` removem; os caminhos de partida de um `find` que apaga ou roda um programa que escreve.
- **Confira pelo corpus que isso não trava o trabalho** ([corpus de comandos reais](../patterns/real-command-corpus.md)).
- **Registre o que continua fora do alcance.** Um programa que monta o nome em tempo de execução não se vê pelo texto do comando: isso vai para os limites da [ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md).

## Exemplo do erro

```js
// Antes: só o nome escrito na linha era protegido.
if (path.basename(target) === gateCacheFile) return deny(…)
// `rm -f .git/loop-*` e `find .git -delete` passavam.
```

## Status

- **Criado**: 2026-09-26 (Fase: Learn), das brechas que a revisão adversarial dos hooks da #5 provou (#5)
- **Status**: Active
