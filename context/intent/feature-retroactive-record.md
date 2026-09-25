# Feature: Registro retroativo do projeto

## Declaração de intenção

Os 9 commits anteriores ao loop, de `0c8e760` a `fb4a804` (todos de 2026-09-24), tomaram decisões que só existem no código e no histórico:

- o Swagger como fonte única;
- o código gerado e commitado;
- um módulo Nest por tag;
- DTOs como interfaces;
- factories faker com overrides e seed.

Sem registro, quem chegar depois não tem como separar o que é decisão do que é acidente. Isso vale também para o lite-campaign, que consome este mock. Esta feature registra essas decisões no Context Mesh, junto com os padrões que o código segue e os erros que o histórico mostra, para que a revisão possa conferi-los.

## Critérios de aceite

- [ ] As ADRs 0004 a 0008 existem com `Accepted`, e todo racional que o histórico não registra aparece marcado como "(inferido; confirmar)":
  - `0004-swagger-as-single-source-with-committed-generated-code.md`: registra o sha256 do Swagger e a divergência com a cópia do lite-campaign;
  - `0005-nestjs-express-one-module-per-tag.md`;
  - `0006-dtos-as-typescript-interfaces.md`;
  - `0007-faker-factories-with-overrides-and-seed.md`;
  - `0008-toolchain.md`.
- [ ] `0009-behaviour-beside-generated-code.md` existe como `Proposed` e diz quando será aceita: na primeira sub-issue da Track A que construir comportamento.
- [ ] Os patterns existem em `context/knowledge/patterns/`:
  - `generate-and-check`;
  - `generated-code-boundary`;
  - `resource-module-shape`;
  - `factory-with-overrides`;
  - `review-before-merge`;
  - `risk-classified-review`. Nele, `HIGH` cobre o contrato Swagger e o envelope, o código gerado, os geradores, o CI e o harness, e tudo o que o lite-campaign consome.
- [ ] Os anti-patterns existem em `context/knowledge/anti-patterns/`, e cada um cita o commit ou a issue onde o erro aconteceu:
  - `hand-editing-generated-code`;
  - `moving-generated-folders-without-the-generator`;
  - `commit-message-understating-its-content`;
  - `literal-route-after-param-route`.
- [ ] Existem `context/knowledge/glossary.md` e `CODING_STANDARDS.md`. O `CODING_STANDARDS.md` só tem links, um para cada pattern e para cada anti-pattern.
- [ ] O changelog tem uma entrada retroativa para os 9 commits pré-loop.
- [ ] `context/decisions/README.md` lista as decisões de 0001 a 0009, cada uma com o mesmo status do arquivo dela.
- [ ] `npm run check:context` passa, e o `AGENTS.md` roteia para os arquivos novos.
- [ ] Os critérios ao vivo que ficaram para esta PR são marcados, cada um citando a própria evidência:
  - o da #3: a primeira auditoria de `main` ficou verde e não abriu issue;
  - o da #13: a PR #15 esperou a revisão do Copilot na cabeça e tinha zero threads abertas no merge, como mostra o comentário de evidência na #13.

## Abordagem técnica

- **Fatos com citação.** Todo fato cita `arquivo:linha` ou um commit. Os fatos vêm de uma leitura do `origin/main` e do histórico, com as contagens medidas por script:
  - 255 definições, 220 operações, 186 caminhos e 23 tags no Swagger;
  - 23 módulos de recurso;
  - 255 factories;
  - 11 rotas literais sombreadas.
- **Inferências marcadas.** O que o histórico não diz, como o porquê de uma escolha, vem marcado "(inferido; confirmar)". O dono confirma ou corrige na revisão.
- **Os defeitos ficam fora.** Os anti-patterns descrevem os defeitos, mas não os corrigem. Cada um aponta para o relato que o acompanha: a #7 (geradores no layout antigo) e a #8 (rotas sombreadas).
- **As ADRs começam em 0004.** O plano aprovado numerava as ADRs retroativas de 0003 a 0008, mas a #13 criou a 0003 antes desta issue. Cada ADR retroativa desce um número, e o slug de cada uma não muda.

## Perguntas em aberto

Respondidas pelo dono no Approve da #4 (2026-09-25), "seguindo suas recomendações":

1. As ADRs retroativas entram como `Accepted`, com o racional inferido marcado, porque o código já é a decisão.
2. Nenhuma decisão além das listadas precisa entrar agora: "não observei nada fora da listagem".

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #4 (#4)
- **Status**: In Progress
