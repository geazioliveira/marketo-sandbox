# Anti-pattern: Limite da auditoria tirado do evento

## Resumo

Uma auditoria que julga só o intervalo do evento que a disparou (`github.event.before..after`) perde tudo o que chegou sem disparar evento.

## Problema

A primeira versão da auditoria de `main` na #3 julgava `before..after` de cada push. Parece completo, mas vários tipos de push não disparam run nenhuma:

- a mensagem traz `[skip ci]` ou o trailer `skip-checks: true`;
- o push foi feito com o `GITHUB_TOKEN`;
- a run foi cancelada na fila.

Os commits desses pushes ficam antes do `before` do push seguinte, e nenhuma auditoria os olha. Uma revisão adversarial da #3 achou isso. A primeira correção trocou o limite pela última run concluída, e as verificações acharam as variações:

- uma run interrompida no meio ainda contava como auditada;
- um force-push tira o topo antigo do clone, então a reescrita não aparecia.

## O que fazer em vez disso

- **Tire o limite do último estado julgado,** não do evento. Aqui, isso é o topo da run mais recente cujo passo `Julgar` terminou.
- **Separe "julguei" de "achei problema",** em passos diferentes, para que uma run vermelha por achado não se confunda com uma que parou no meio.
- **Quando esse estado sumiu do clone,** pergunte à fonte (o compare do GitHub) antes de recuar. E recue para o lado que julga mais (a linha de base), não para o que julga menos (o `before`).
- **Tenha um gatilho agendado,** para que haja uma próxima auditoria mesmo sem push.

Veja a camada 6 da [ADR 0002](../../decisions/0002-soft-enforcement-on-github-free.md).

## Exemplo do erro

```yaml
# Antes: só o intervalo do evento; um push sem run nunca é julgado.
env:
  BEFORE: ${{ github.event.before }}
  AFTER: ${{ github.event.after }}
run: node scripts/audit-main.mjs   # julga BEFORE..AFTER
```

## Status

- **Criado**: 2026-09-25 (Fase: Learn), das revisões adversariais da implementação da #3 (#3)
- **Status**: Active
