# Project intent: marketo-sandbox

## Declaração de intenção

- **Problema.** Clientes da API REST do Marketo Engage, a começar pelo lite-campaign, precisam ser desenvolvidos e testados sem uma instância Marketo. As instâncias sandbox são escassas e compartilhadas, têm limite de taxa e exigem credenciais que não podem ir para o CI. Simuladores escritos à mão dentro de cada cliente se afastam da API e viram fonte de defeitos: o simulador do lite-campaign foi a origem de brunohab/lite-campaign#47, #54, #60 e #61.
- **Valor.** Um único serviço HTTP local, sem credenciais, gerado a partir do Swagger oficial. Toda rota documentada existe e responde no formato documentado, e os clientes deixam de reimplementar o Marketo.
- **Visão.** Os consumidores rodam seus testes de ponta a ponta contra o mock em loopback, fixados numa release com tag. O mock é fiel ao contrato documentado e, além de ter as rotas, reproduz o comportamento que um cliente precisa provar: estado, autenticação, falhas e validação estrita. Quando falta algo, a correção é feita aqui, nunca com um contorno no consumidor.
- **Usuários.** Quem desenvolve um consumidor (o lite-campaign e os agentes dele); as suítes de teste e o CI desses consumidores; o dono, que mantém o projeto e escreve o Approve; e os agentes do Claude Code que implementam depois do Approve.

## Tipo de projeto

Serviço HTTP de mock para desenvolvimento e testes, rodando em loopback. Não é biblioteca, não é produto implantado e não é uma instância Marketo.

## Stack

- NestJS 12 sobre Express, com um módulo por tag do Swagger.
- DTOs como interfaces TypeScript.
- Respostas geradas por factories faker com overrides e seed.
- Código gerado por scripts Python a partir de `docs/marketo-swagger-asset.json`.
- vitest, oxlint, prettier e TypeScript 6.

As decisões por trás de cada item são registradas de forma retroativa na #4.

## Critérios de aceite

Nenhum está marcado ainda: um critério só é marcado quando um teste ou um check o prova.

- [ ] Cada operação do Swagger de assets (220 operações, 186 caminhos, 23 tags) tem uma rota que chega ao próprio handler e responde um envelope bem formado. Hoje as rotas existem, mas 11 podem estar sombreadas (#8).
- [ ] O código gerado é exatamente o que os geradores emitem: `npm run check:all` passa num clone limpo. Hoje falha (#7).
- [ ] Com `MARKETO_MOCK_SEED`, a mesma requisição devolve o mesmo payload entre reinícios. Já está implementado, mas sem teste.
- [ ] Por padrão, nenhuma requisição sai da máquina e o servidor escuta em 127.0.0.1. Hoje o `ObserveModule` fica ligado e o servidor escuta em todas as interfaces (#9).
- [ ] Um consumidor fixa uma release com tag e a sobe com um comando documentado.
- [ ] Espaços isolados, autenticação, modelo com estado, log de requisições, falhas roteirizadas e validação estrita, como pede a Track A do lite-campaign (R1–R8).
- [ ] O mock registra qual cópia do Swagger o gerou (sha256).
- [ ] Toda mudança nasce numa issue, com plano e Approve do dono, e entra por uma PR que fecha essa issue (#1).
- [ ] O CI roda lint, typecheck, testes, build e `check:all` em toda PR (#3 e #7).

## Fora de escopo

- Servir de proxy para um Marketo real.
- Servir de evidência de que algo funciona numa instância real: um consumidor nunca chama o mock de "verificado".
- Deploy ou hospedagem. O script `deploy` e o `@nestjs/mau` são sobras do starter (#9).
- Fidelidade de desempenho ou de carga.
- Comportamento que o Swagger não documenta, exceto quando registrado como inferência.
- Segurança real: os tokens são tokens de mock.

## Decisões em aberto

- **A reescrita multi-API** (5 documentos Swagger, registro de alvos) está no checkout principal sem commit e entra por PR (#6).
- **Qual cópia do Swagger de assets vale.** Aqui é `ced6c339…` (255 definições); o lite-campaign fixa `ff7ec628…` (254). A escolha sai de um diff nas rotas que o consumidor usa.
- **Onde vive o comportamento com estado:** ao lado do código gerado, nunca dentro dele. Vira decisão na #4.
- **ObserveModule:** tornar opt-in ou remover (#9).
- **Esquema de release e tag** que os consumidores fixam.
- **Versão do Node:** `.nvmrc` com 24, na #2.

## Status

- **Criado**: 2026-09-24 (Fase: Intent), a partir do código em `fb4a804` e do plano do consumidor lite-campaign (#2)
- **Status**: In Progress
