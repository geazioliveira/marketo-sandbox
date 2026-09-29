# Anti-pattern: Uma porta efêmera nova a cada requisição do supertest

## Resumo

Passar ao supertest o servidor sem porta faz ele escutar numa porta efêmera nova a cada requisição, e num teste com centenas de requisições uma delas pode cair numa porta que outro processo da máquina escuta em `127.0.0.1`, que responde no lugar do app.

## Problema

- **`request(app.getHttpServer())` abre o servidor numa porta efêmera a cada requisição**, porque o servidor do Nest ainda não escuta, e o supertest conecta em `127.0.0.1` nessa porta.
- **Na #24, o teste de conformidade manda 388 requisições.** Em 5 execuções seguidas, com a máquina carregada, 2 tiveram uma operação a mais falhando, cada vez uma diferente: `POST /rest/asset/v1/smartCampaign/{id}.json` e `POST /rest/asset/v2/emailtemplate/state/transition` receberam `403` com `content-type: text/plain`, que o app nunca responde. A resposta vinha de outro processo local.
- **A falha parece do código.** O teste acusa uma operação de responder fora do documento, e o seed do faker faz a falha parecer não determinística no próprio app.

## O que fazer em vez disso

- **Escute uma vez só, num endereço fixo, e mande as requisições para ele:**

  ```ts
  await app.listen(0, '127.0.0.1')
  const { port } = app.getHttpServer().address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  // request(origin).get(...)
  ```

  É o que fazem o `test/response-schema.e2e-spec.ts` e o `test/multipart.e2e-spec.ts` da #24.
- **Desconfie de uma resposta que o app não sabe dar.** Um `content-type` ou um status que nenhum handler produz aponta para outro servidor, não para o handler.

## Exemplo do erro

```ts
// a primeira versão do test/response-schema.e2e-spec.ts (#24)
for (const documented of operations) {
  const agent = request(app.getHttpServer())
  // ...
}
```

## Status

- **Criado**: 2026-09-28 (Fase: Learn), do teste de conformidade da #24, que falhou de forma intermitente até escutar uma vez só (#24)
- **Status**: Active
