# ADR 0013: O corpo multipart lido num interceptor escrito à mão

## Contexto

- **Um upload não chegava ao handler.** O Nest sobre Express monta só os parsers de JSON e de urlencoded. O gerador de resources mapeia `formData` para `@Body('<nome>')` e `in: body` para `@Body()` (`scripts/generate-marketo-resources.py:37-42`), e sem parser de multipart o `req.body` ficava `undefined`. Medido em `e5b013c` com um `vi.spyOn` no service: `POST /bulk/v1/leads.json?format=csv` com `leads.csv` anexado respondia 200, e o service recebia `file` como `undefined`.
- **Os documentos declaram as partes de dois jeitos.** São 11 POSTs que consomem `multipart/form-data`:
  - 3 bulk imports de Lead Database, com `file` declarado `type: file` em `formData`;
  - 5 uploads de assets com o corpo num `in: body` cujo schema traz a parte de arquivo como uma propriedade `string`, que só a descrição chama de "Multipart file", como `CreateFileRequest.file`;
  - 1 de assets com `content` em `formData` e 2 sem parâmetro de corpo.
- **O `multer` já vinha no lockfile**, na 2.2.0, como dependência do `@nestjs/platform-express`.
- **Um middleware do Nest vira uma rota do Express.** O `MiddlewareConsumer.forRoutes()` registra o middleware com `app.all(<caminho>)` (`node_modules/@nestjs/core/middleware/middleware-module.js:172-194`), e um middleware para todas as rotas vira a rota `/{*splat}`, que casa com toda requisição antes das rotas documentadas. O e2e da #6 (nenhuma rota fora dos documentos) e o da #8 (toda requisição chega à própria rota) falharam com ele.

## Decisão

- **O `MultipartInterceptor`, escrito à mão em `src/multipart/`, lê o corpo multipart** e põe cada parte em `req.body`, com o nome com que ela foi enviada: uma parte de texto vira string, e uma de arquivo, o arquivo que o multer leu em memória (`src/multipart/multipart.interceptor.ts`). O `MultipartModule` o registra como `APP_INTERCEPTOR`, e o `AppModule` importa o `MultipartModule` (`src/app.module.ts:6,15`).
- **O gerador não muda.** O `@Body('file')` e o `@Body()` gerados recebem as partes como vieram, nas 11 operações.
- **Um corpo multipart malformado responde 400** e não chega ao handler.
- **Sem limite de tamanho.** O arquivo fica em memória (pergunta 3 do plano da #24).
- **O `multer` entra em `dependencies` com `^2.2.0`**, e o lockfile continua na 2.2.0, a mesma do `@nestjs/platform-express`. O `@types/multer` entra em `devDependencies`, porque o multer 2.2 não traz tipos.
- **Os tipos gerados ficam como o documento diz.** `CreateFileRequest.file` continua `string`, e o handler recebe o objeto do multer.

## Racional

- **Um lugar cobre os dois jeitos de declarar.** Nas 5 operações de assets, a parte de arquivo só se distingue pela descrição. Gerar `FileInterceptor` e `@UploadedFile()` pediria uma heurística sobre descrições no gerador, e mesmo assim o `@Body()` gerado não receberia as partes sem um passo a mais escrito à mão (pergunta 1 do plano da #24).
- **Ao lado do gerado, nunca dentro.** O parser é um ponto transversal do Nest registrado num módulo escrito à mão, como a [ADR 0009](0009-behaviour-beside-generated-code.md) prevê, e regenerar não o apaga.
- **Um interceptor, não um middleware.** O plano aprovado dizia middleware. O middleware quebrou os e2e da #6 e da #8, e o dono escolheu o interceptor no Build da #24. Um interceptor roda depois de o Express escolher a rota e antes de o Nest ler os parâmetros do handler, como o `FileInterceptor` do próprio Nest, e não acrescenta rota nenhuma ao roteador.
- **O mock só escuta a própria máquina por padrão** ([ADR 0010](0010-loopback-only-by-default.md)), e o limite que a Marketo documenta para o bulk import, de 10 MB, não está no documento e valeria também para os uploads de assets.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| Um middleware com `forRoutes('{*splat}')` | Vira uma rota do Express que casa com toda requisição antes das documentadas, e quebra os e2e da #6 e da #8 |
| Um middleware com `app.use()` no `main.ts` | Os e2e montam o app pelo `AppModule`, sem o `main.ts`, e não o veriam |
| O gerador emitir `FileInterceptor('file')` e `@UploadedFile()` para `type: file`, e `AnyFilesInterceptor()` nas outras | Precisaria de uma heurística sobre a descrição nas 5 operações de assets e, sem juntar as partes em `req.body`, o `@Body()` gerado ainda não as receberia |
| Um limite de 10 MB por arquivo, com 413 | Não está no documento, e o mock é local |

## Consequências

- **Mais fácil**:
  - um comportamento da Track A que precise do conteúdo de um upload já o recebe no service;
  - uma operação multipart nova, declarada de qualquer um dos dois jeitos, funciona sem mudar o gerador, e o `test/multipart.e2e-spec.ts` a acha pelo documento.
- **Mais difícil**:
  - **o interceptor roda em toda rota.** Ele lê um corpo multipart mandado a uma rota que não o declara. O multer ignora uma requisição que não é multipart, e o teste do multipart prova que JSON e urlencoded não mudam;
  - **o tipo mente nas 5 operações de assets.** O handler recebe o objeto do multer onde o tipo diz `string`. Hoje nenhum service lê os argumentos;
  - **um upload grande fica inteiro em memória.**

## Relacionados

- [ADR 0009: Comportamento ao lado do código gerado, nunca dentro](0009-behaviour-beside-generated-code.md), que esta decisão aplica ao transporte, sem aceitá-la: a 0009 continua `Proposed` até a primeira sub-issue da Track A
- [ADR 0010: O mock só fala com a própria máquina por padrão](0010-loopback-only-by-default.md)
- [Pattern: A forma de um módulo de recurso](../knowledge/patterns/resource-module-shape.md)
- [Anti-pattern: Middleware do Nest para todas as rotas, que vira uma rota](../knowledge/anti-patterns/nest-middleware-as-a-catch-all-route.md)
- [Bug: Código gerado fora do schema e upload multipart que não chega ao handler](../intent/bug-generated-code-off-schema.md)

## Status

- **Criado**: 2026-09-28 (Fase: Build), do plano aprovado na issue #24 e da troca do middleware pelo interceptor, escolhida pelo dono no Build (#24)
- **Status**: Accepted
