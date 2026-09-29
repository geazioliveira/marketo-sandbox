# Anti-pattern: Uma porta efêmera nova a cada requisição do supertest

## Resumo

Passar ao supertest o servidor sem porta faz ele escutar, a cada requisição, numa porta efêmera nova no endereço curinga, e conectar em `127.0.0.1`. No macOS, um outro processo que escute nessa mesma porta em `127.0.0.1` responde no lugar do app, e num teste com centenas de requisições isso apareceu como uma falha intermitente.

## Problema

- **O que o supertest faz.** `request(app.getHttpServer())`, com o servidor do Nest ainda sem escutar, chama `app.listen(0)` sem endereço e conecta em `127.0.0.1:<porta>` (`node_modules/supertest/lib/test.js:61-69`). Sem endereço, o Node escuta em `::`, o curinga.
- **O que foi provado na #24, no macOS.** Com um processo escutando em `127.0.0.1:<porta>`, um `listen(<porta>)` sem endereço dá certo (`{"address":"::","port":<porta>}`), e uma requisição a `127.0.0.1:<porta>` é respondida pelo outro processo, o do bind mais específico. O bind curinga não enxerga o conflito, e a conexão não chega ao app.
- **O que aconteceu.** O teste de conformidade da #24 manda 388 requisições. Em 5 execuções seguidas, com a máquina carregada, 2 tiveram uma operação a mais falhando, cada vez uma diferente: `POST /rest/asset/v1/smartCampaign/{id}.json` e `POST /rest/asset/v2/emailtemplate/state/transition` receberam `403` com `content-type: text/plain`, que o app nunca responde. Com o app escutando uma vez só em `127.0.0.1`, a falha não voltou.
- **O que é inferência.** Que a porta efêmera escolhida para o curinga tenha sido, nessas duas vezes, uma que outro processo já escutava em `127.0.0.1`, e que o `403` veio desse processo, não foi medido na hora. É a explicação que o mecanismo provado e o sumiço da falha sustentam (inferido; confirmar). Com um bind explícito em `127.0.0.1`, o conflito com outro bind no mesmo endereço e porta é recusado pelo sistema, e o caminho some.
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
- **Atualizado**: 2026-09-29 (Fase: Learn), o mecanismo separado entre o provado (o bind curinga do supertest convive no macOS com o bind de outro processo em `127.0.0.1`, que responde) e o inferido, pela revisão do Copilot na PR #62 (#24)
