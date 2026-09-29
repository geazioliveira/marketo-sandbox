# Anti-pattern: Middleware do Nest para todas as rotas, que vira uma rota

## Resumo

Registrar um middleware para todas as rotas com o `MiddlewareConsumer` acrescenta ao roteador do Express uma rota que casa com toda requisição, antes das rotas documentadas.

## Problema

- **O plano da #24 previa um middleware** para ler o corpo multipart, registrado com `forRoutes({ path: '{*splat}', method: RequestMethod.ALL })`. O Nest registra um middleware com o método do Express que corresponde ao `RequestMethod`, `app.all(<caminho>)` para `ALL` (`node_modules/@nestjs/core/middleware/middleware-module.js:172-194`). O middleware vira a rota `/{*splat}`, com os 35 métodos que o Express conhece.
- **Dois e2e pegaram o erro na hora.** O da #6 achou `ACL /{*splat}`, `GET /{*splat}` e as outras 33 rotas fora dos documentos. O da #8 viu toda requisição casar primeiro com `/{*splat}`, antes da própria rota.
- **Nada disso aparece rodando o app.** O middleware chama `next()`, e toda requisição ainda chega ao handler. Só um teste que lê o roteador montado vê a rota a mais.

## O que fazer em vez disso

- **Para um trabalho que precisa da rota já escolhida, use um interceptor global** (`APP_INTERCEPTOR`) num módulo escrito à mão. Ele roda depois de o Express escolher a rota e antes de o Nest ler os parâmetros do handler, como o `FileInterceptor` do próprio Nest, e não acrescenta rota nenhuma. É o que a #24 fez ([ADR 0013](../../decisions/0013-multipart-read-by-a-hand-written-interceptor.md)).
- **Depois de mudar o que o app registra, rode os e2e do roteador** (`test/marketo-api.e2e-spec.ts` e `test/route-order.e2e-spec.ts`), e não só o teste da própria mudança.

## Exemplo do erro

```ts
// src/multipart/multipart.module.ts, descartado no Build da #24
export class MultipartModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(multipartMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL })
  }
}
```

## Status

- **Criado**: 2026-09-28 (Fase: Learn), do Build da #24, em que o middleware previsto no plano quebrou os e2e da #6 e da #8 (#24)
- **Status**: Active
