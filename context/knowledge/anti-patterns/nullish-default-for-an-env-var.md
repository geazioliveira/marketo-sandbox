# Anti-pattern: Padrão com `??` para uma variável de ambiente

## Resumo

`process.env.X ?? padrão` só troca `undefined`, então uma variável definida e vazia passa adiante como string vazia, e o padrão nunca vale.

## Problema

Uma variável de ambiente pode existir e estar vazia. `HOST=` num `.env`, um `export HOST=` esquecido ou um `env:` de CI com o valor em branco são exemplos. O operador `??` só troca `null` e `undefined`, então `process.env.HOST ?? '127.0.0.1'` devolve `''`.

Na #9, o plano aprovado pedia o `HOST` com padrão `127.0.0.1`, e o jeito óbvio de escrever era esse. Medido na #9: `listen(0, '')` escuta em `::`, todas as interfaces. É justamente o que o padrão existia para impedir. O `PORT` tem o mesmo defeito: `Number('')` é 0, e a porta vira aleatória em vez de 3000.

## O que fazer em vez disso

- **Trate vazio e em branco como ausente:** `env.HOST?.trim() || padrão`.
- **Leia as variáveis numa função pura que recebe o ambiente,** como `listenAddress(process.env)` em `src/listen-address.ts`. Assim o teste passa `{}`, `{ HOST: '' }` e `{ HOST: '  ' }` sem mexer no `process.env`.
- **Ponha o caso vazio no teste,** ao lado do padrão e da troca (`test/runtime-defaults.spec.ts`).

Veja a [ADR 0010](../../decisions/0010-loopback-only-by-default.md).

## Exemplo do erro

```ts
// HOST= (vazio) escuta em todas as interfaces, e PORT= numa porta aleatória.
await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1')
```

## Status

- **Criado**: 2026-09-26 (Fase: Learn), da medição feita para o plano da #9 (#9)
- **Status**: Active
