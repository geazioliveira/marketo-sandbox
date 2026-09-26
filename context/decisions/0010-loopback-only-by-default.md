# ADR 0010: O mock só fala com a própria máquina por padrão

## Contexto

- **O mock é um serviço de loopback.** Ele existe para desenvolver e testar sem credenciais e sem uma instância Marketo, e o lite-campaign o consome assim ([project intent](../intent/project-intent.md)). Um critério de aceite do project intent pedia que, por padrão, nenhuma requisição saísse da máquina e que o servidor escutasse em `127.0.0.1`. A decisão em aberto "ObserveModule: tornar opt-in ou remover" apontava para a #9.
- **O starter deixou a telemetria ligada.** Em `610e101`, o `AppModule` montava o `ObserveModule.forRoot` do `@nestjs/observe` 0.3.0 com `appKey` e `appSecret` vazios, e o `src/main.ts` passava o `ObserveInstrument` ao `NestFactory.create`. Medido na #9:
  - O worker do pacote descarrega a cada 5 s para `process.env.OBSERVE_ENDPOINT ?? "https://observe-api.nestjs.com"`. O endereço é lido em `dist/agent/observe-agent.worker.js:31`, no pacote.
  - Numa execução de 20 s com 5 GETs, o app mandou 2 `POST /applications/telemetry`. Ocioso, ele manda um lote de métricas de runtime por minuto.
  - Sem as chaves, o lote sai do mesmo jeito, só sem os headers de autenticação.
  - O pacote não tem opção que desligue o agente. Desligar é não importar o módulo.
  - Com o módulo, o processo roda com 13 threads e aloca um `SharedArrayBuffer` de 16 MB. Sem ele, roda com 8 threads.
- **O servidor escutava em todas as interfaces.** `app.listen(process.env.PORT ?? 3000)` não passava host, e o `lsof` mostrava `TCP *:<porta> (LISTEN)`.
- **O loop carregava um contorno.** O e2e do CI e o comando do fluxo usavam `OBSERVE_ENDPOINT=http://127.0.0.1:9`. O contorno funcionava porque o `fetch` recusa a porta 9 como "bad port", sem abrir socket. Só valia onde alguém lembrava da variável: um `npm run start` sem ela mandava telemetria. O e2e de um teste, na verdade, nunca mandou nada em 11 execuções. O `TestingModule` não recebe o `instrument`, e só um e2e com mais de uns 60 s mandaria o lote de runtime.
- **O R1 da Track A do lite-campaign pede o mesmo.** Ele pede o `ObserveModule` opt-in e o `HOST` com padrão `127.0.0.1`, entre outros itens.

## Decisão

- **Nenhuma dependência de telemetria.** O `@nestjs/observe` sai do código e das dependências. `test/runtime-defaults.spec.ts` falha se ele voltar ao `package.json` ou a um import em `src/`.
- **O servidor escuta em loopback.** O endereço vem de `listenAddress(process.env)`, em `src/listen-address.ts`. `HOST` tem padrão `127.0.0.1` e `PORT` tem padrão 3000. Uma variável vazia ou em branco conta como ausente, porque `listen(port, '')` escutaria em todas as interfaces. `HOST=0.0.0.0` abre o mock para outras máquinas ou containers.
- **Uma biblioteca que fale com a rede em runtime pede uma decisão nova.** Ela só entra desligada por padrão, e a decisão diz como ligá-la.
- **A instalação fica fora desta decisão.** O `postinstall` do `@scarf/scarf`, que vem pelo `@nestjs/swagger`, manda um evento a cada `npm ci`. Isso é tratado na #20.

## Racional

- **O mock não tem uso para APM.** A remoção tira a dependência, o worker, o contorno do CI e o único aviso do lint (`no-extra-boolean-cast`, na config do Observe).
- **A remoção falha alto, e o opt-in não.** A #6 vai transferir a reescrita multi-API, que ainda traz o `app.module.ts` antigo. Se esse arquivo for copiado por cima, a remoção faz o typecheck e a guarda falharem, porque o pacote não está mais instalado. Com o opt-in, a cópia religaria a telemetria sem erro de compilação.
- **O padrão de loopback segue o uso.** Quem consome o mock roda na mesma máquina. Quem precisa de outra máquina escolhe isso com `HOST`.

## Alternativas consideradas

| Opção | Por que não |
| --- | --- |
| O `ObserveModule` opt-in, com o módulo e o `instrument` montados só com `OBSERVE_APP_KEY` e `OBSERVE_APP_SECRET`, como o R1 pede | Mais código, um teste para cada caminho, e uma cópia do `app.module.ts` antigo religaria a telemetria sem erro de compilação. O dono aprovou a remoção (pergunta 1 do plano da #9) |
| Manter o Observe e o `OBSERVE_ENDPOINT` em loopback | Só vale onde alguém lembra da variável |
| Deixar o `HOST` para a Track A | O critério do project intent ficaria pela metade (pergunta 2 do plano da #9) |
| Uma guarda de rede em runtime, com um preload que bloqueia toda conexão para fora do loopback | Ela veria até as worker threads, como a medição da #9 mostrou. Mas precisaria subir o app compilado dentro do teste, e hoje a única biblioteca conhecida que mandava dados é o `@nestjs/observe`, que a guarda estática já cobre. A medição com o preload vai na Verificação da PR |

## Consequências

- **Mais fácil**:
  - o e2e, o `npm run start` e o CI rodam sem variável de ambiente;
  - o lockfile tem 47 pacotes a menos, e o processo tem 8 threads em vez de 13;
  - o lint fica sem avisos.
- **Mais difícil**:
  - acessar o mock de outra máquina ou de um container exige `HOST=0.0.0.0`;
  - `GET /` responde 404, e não mais o Hello World;
  - o mock só escuta em IPv4, então um cliente que resolva `localhost` só para `::1` não o alcança (inferido; no macOS medido, `localhost` resolve primeiro para `127.0.0.1`);
  - a transferência da #6 precisa mesclar `src/app.module.ts`, `src/main.ts` e `README.md`, em vez de copiá-los;
  - quem quiser APM precisa de uma decisão nova.
- **O que fica para a Track A**: `PORT=0` imprimir a URL, recusar `NODE_ENV=production`, uma mensagem legível para `EADDRINUSE` e a release com tag.

## Relacionados

- [Project intent](../intent/project-intent.md), cujo critério da rede e da escuta esta decisão fecha
- [Feature: Remover as sobras do starter NestJS e a telemetria padrão](../intent/feature-remove-starter-leftovers.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](0002-soft-enforcement-on-github-free.md), cuja camada 1 perdeu o contorno do e2e
- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), que descreve o `src/main.ts`
- [ADR 0008: A toolchain](0008-toolchain.md)
- A telemetria de instalação do `@scarf/scarf` (#20)

## Status

- **Criado**: 2026-09-26 (Fase: Learn), do plano aprovado na #9 e das medições feitas para ele (#9)
- **Status**: Accepted
