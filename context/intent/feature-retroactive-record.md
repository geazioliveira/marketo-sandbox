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

- [x] As ADRs 0004 a 0008 existem com `Accepted`, e todo racional que o histórico não registra aparece marcado como "(inferido; confirmar)":
  - `0004-swagger-as-single-source-with-committed-generated-code.md`: registra o sha256 do Swagger e a divergência com a cópia do lite-campaign;
  - `0005-nestjs-express-one-module-per-tag.md`;
  - `0006-dtos-as-typescript-interfaces.md`;
  - `0007-faker-factories-with-overrides-and-seed.md`;
  - `0008-toolchain.md`.
- [x] `0009-behaviour-beside-generated-code.md` existe como `Proposed` e diz quando será aceita: na primeira sub-issue da Track A que construir comportamento.
- [x] Os patterns existem em `context/knowledge/patterns/`:
  - `generate-and-check`;
  - `generated-code-boundary`;
  - `resource-module-shape`;
  - `factory-with-overrides`;
  - `review-before-merge`;
  - `risk-classified-review`. Nele, `HIGH` cobre o contrato Swagger e o envelope, o código gerado, os geradores, o CI e o harness, e tudo o que o lite-campaign consome.
- [x] Os anti-patterns existem em `context/knowledge/anti-patterns/`, e cada um cita o commit ou a issue onde o erro aconteceu:
  - `hand-editing-generated-code`;
  - `moving-generated-folders-without-the-generator`;
  - `commit-message-understating-its-content`;
  - `literal-route-after-param-route`.
- [x] Existem `context/knowledge/glossary.md` e `CODING_STANDARDS.md`. O `CODING_STANDARDS.md` só tem links, um para cada pattern e para cada anti-pattern.
- [x] O changelog tem uma entrada retroativa para os 9 commits pré-loop.
- [x] `context/decisions/README.md` lista as decisões de 0001 a 0009, cada uma com o mesmo status do arquivo dela.
- [x] `npm run check:context` passa, e o `AGENTS.md` roteia para os arquivos novos.
- [x] Os critérios ao vivo que ficaram para esta PR são marcados, cada um citando a própria evidência:
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

Respondidas pelo dono no Approve da #4 (2026-09-25): "pode seguir com o plano da #4 com as suas recomendações".

1. As ADRs retroativas entram como `Accepted`, com o racional inferido marcado, porque o código já é a decisão.
2. Nenhuma decisão além das listadas precisa entrar agora: "não observei nada fora da listagem".

## Decisões relacionadas

- [0001: Context Mesh no repositório e loop issue-first](../decisions/0001-context-mesh-in-the-repository.md)
- [0003: Revisão do Copilot na cabeça e nenhuma thread aberta antes do merge](../decisions/0003-copilot-review-and-no-open-threads-before-merge.md)

## Patterns relacionados

- [O gate do loop](../knowledge/patterns/loop-gate.md)
- [Ciclo de vida de issue e branch](../knowledge/patterns/issue-branch-lifecycle.md)

## Resultados

O que foi construído está na [entrada do changelog](../evolution/changelog.md), e os nove commits pré-loop estão na entrada retroativa do fim dele. Cada documento foi escrito a partir de uma leitura do código e do histórico. Depois, um verificador adversarial por grupo refez cada fato: abriu cada `arquivo:linha` citado, recontou os números e mediu numa cópia de `origin/main` o que dava para medir.

Desvios do plano e achados:

- **As ADRs começam em 0004.** A #13 criou a 0003, então cada ADR retroativa desceu um número, e o slug de cada uma não mudou.
- **Medições no lugar de inferências.** Quatro pontos que seriam "(inferido; confirmar)" foram medidos:
  - as 11 rotas sombreadas caem no handler da `:id`;
  - nenhum commit anterior a `fb4a804` passa no `tsc`;
  - o Swagger UI serve 0 schemas;
  - o seed fixa a sequência de chamadas, não cada resposta.

  Duas inferências dos rascunhos estavam erradas e foram corrigidas: o `npm ci --omit=dev` e as "34 respostas sem envelope".
- **Um achado novo para a #8.** `GET form/fields.json` e `GET form/programMemberFields.json` também casam com `form/:id.json`, de outro controller. Só escapam porque o `FormFieldsModule` é importado antes do `FormsModule` ([ADR 0005](../decisions/0005-nestjs-express-one-module-per-tag.md)).
- **O project intent foi corrigido em dois critérios**, sem mudar o que eles pedem:
  - as 11 rotas deixaram de ser "podem estar sombreadas" e passaram a ser medidas;
  - o seed hoje só repete o payload para a mesma sequência de requisições desde o boot ([ADR 0007](../decisions/0007-faker-factories-with-overrides-and-seed.md)).
- **Um critério a mais: os critérios ao vivo da #3 e da #13.** O plano da #4 não os tinha. Os intents delas deixaram esses critérios para esta PR, e eles foram marcados com a evidência de cada um.
- **A PR é `HIGH`, não `NORMAL`.** O plano previa só documentação. A PR também muda um teste de drift do harness (`test/scripts/drift.spec.ts`). Antes, ele garantia que os números de decisão prometidos à #4 estavam livres; agora garante que cada um existe. O pattern [revisão classificada por risco](../knowledge/patterns/risk-classified-review.md) sobe para `HIGH` uma PR que toca um teste do harness.
- **Os commits.** Os passos 3 e 4 do plano (patterns e anti-patterns; glossário, `CODING_STANDARDS.md` e roteamento) saíram num commit só. Os critérios da #3 e da #13 ganharam um commit próprio.
- **Os dois patterns de revisão não vêm dos commits pré-loop.** `review-before-merge` e `risk-classified-review` registram o que o loop das #2, #3 e #13 já pratica, e o bloco Status deles diz isso.

Para o dono confirmar ou corrigir na revisão:

- **As inferências marcadas.** São 68 marcas "(inferido; confirmar)" nos arquivos novos (contadas com `grep -o`), a maior parte nas ADRs: 7 na 0004, 10 na 0005, 8 na 0006, 12 na 0007, 15 na 0008 e 8 na 0009. As outras 8 estão em `generate-and-check` (2), `risk-classified-review` (4) e `literal-route-after-param-route` (2).
- **O "à mão" de `5cc5e09`.** O histórico só prova que o prefixo `../../` dos imports não saiu de nenhuma versão do gerador. Ele não diz se foi digitado ou feito por script.
- **O `HIGH` pede que o dono leia a PR antes do merge?** O pattern `risk-classified-review` marca isso como inferência, porque estreitaria a autorização permanente de merge dada na #2.
- **Se a #8 cobre também o caso de `form-fields`.**

## Status

- **Criado**: 2026-09-25 (Fase: Intent), do plano aprovado na #4 (#4)
- **Status**: Completed
- **Atualizado**: 2026-09-25 (Fase: Learn), os documentos existem, verificados contra o código e o histórico, e os critérios ao vivo da #3 e da #13 foram marcados (#4)
