# ADR 0008: A toolchain

## Contexto

- A toolchain veio no `0c8e760`. Até o `fb4a804`, o único ajuste nos arquivos de config (`tsconfig.json`, `.oxlintrc.json`, `.prettierrc`, as duas configs do vitest e o `nest-cli.json`) foi o `ignoreDeprecations` do `01ee283`. Nenhum commit diz por que cada ferramenta foi escolhida: os arquivos de config são a decisão.
- O projeto nasceu do starter do NestJS. O pacote ainda se chama `nest-typescript-starter` (`package.json:2`), e as sobras dele são a #9.
- Os geradores Python dependem do lado Node: eles formatam a saída com o prettier de `node_modules` (`scripts/marketo_codegen.py:80-89`).
- O loop (#2 e #3) acrescentou peças por cima. Esta decisão separa o que é pré-loop do que o loop trouxe, para que ninguém leia um acréscimo do loop como decisão dos commits iniciais.

## Decisão

### Pré-loop, de `0c8e760` a `fb4a804`

- **npm, com lockfile v3.** `package-lock.json` tem `lockfileVersion` 3 desde o `0c8e760` (`package-lock.json:4`). O `package.json` não tem `packageManager` nem `engines`.
- **Node sem versão fixada.** Antes do loop, nenhum arquivo fixava a versão do Node: não havia `.nvmrc` nem `engines`. O `@types/node` `^24.0.0` (`package.json:50`) sugere o Node 24 (inferido; confirmar).
- **TypeScript 6.** `typescript` `^6.0.2` (`package.json:58`), travado em 6.0.3 no lockfile. O `tsconfig.json` (`:3-21`) usa:
  - `module: "commonjs"` e `moduleResolution: "node"` (`:3-4`);
  - `ignoreDeprecations: "6.0"` (`:5`), que chegou no `01ee283`;
  - `target: "ES2023"` (`:14`), `strict: true` com `strictPropertyInitialization: false` (`:19-20`);
  - decorators com metadata, `experimentalDecorators` e `emitDecoratorMetadata` (`:10-11`);
  - `types: ["vitest/globals", "node"]` (`:21`).

  O `tsconfig.build.json` compila só `src` e deixa os specs de fora (`tsconfig.build.json:2-7`).
- **oxlint.** `oxlint` `^1.58.0` (`package.json:53`), travado em 1.80.0. O `.oxlintrc.json` desliga `no-explicit-any` e deixa `no-floating-promises` como aviso (`.oxlintrc.json:3-5`). O script pré-loop era `oxlint src/ test/` (`fb4a804:package.json:23`).
- **Prettier.** `prettier` `^3.4.2` (`package.json:54`), travado em 3.9.6. O `.prettierrc` é `singleQuote: true`, `trailingComma: "all"` e `semi: false` (`.prettierrc:1-5`). O script `format` escreve `src/**/*.ts` e `test/**/*.ts` (`package.json:10`). Os geradores passam a saída por esse mesmo prettier (`scripts/marketo_codegen.py:99`, `:115`). Os DTOs chegaram a esse estilo no `e7a0bb6`: no `0c8e760`, 253 dos 255 tinham linhas terminadas em `;`, e depois dele nenhum.
- **vitest, com duas configs.** `vitest` `^4.1.2` (`package.json:60`), travado em 4.1.11:
  - `vitest.config.ts` pega `**/*.spec.ts` (`vitest.config.ts:11`);
  - `vitest.config.e2e.ts` pega `**/*.e2e-spec.ts` (`vitest.config.e2e.ts:9`);
  - as duas ligam `globals: true` e o `vite-tsconfig-paths`;
  - os scripts são `test`, `test:watch`, `test:cov` (com `@vitest/coverage-v8`), `test:debug` e `test:e2e` (`fb4a804:package.json:24-28`).
- **Build com `nest build`** (`package.json:8`). Nas `compilerOptions`, o `nest-cli.json` só liga `deleteOutDir` e não escolhe builder (`nest-cli.json:5-7`). O swc é só um peer opcional do `@nestjs/cli` (`package-lock.json:649-650`, `:661-666`) e não está instalado pelo lockfile, então o build usa o tsc (inferido; confirmar). `start:prod` roda `node dist/main` (`package.json:22`).
- **Geradores em Python 3.** Os scripts `generate:*` e `check:*` de cada gerador chamam `python3 scripts/generate-marketo-*.py`, e `generate:all` e `check:all` os encadeiam (`package.json:11-18`). Eles só usam a biblioteca padrão (`argparse`, `json`, `re`, `shutil`, `subprocess`, `pathlib` e afins). Nenhum arquivo declara a versão do Python: não há `pyproject.toml`, `requirements.txt` nem `.python-version`. O `:=` (`scripts/generate-marketo-definitions.py:137`) e o `from __future__ import annotations` (`:4`) pedem 3.8 ou mais novo (inferido; confirmar). Na leitura da #4, eles rodaram com o Python 3.9.6 local.

### Acrescentado pelo loop

| O quê | Commit | Issue |
| --- | --- | --- |
| O script `gate`, `scripts/` no `lint` (`package.json:23`) e o `.claude/**` fora das duas configs do vitest (`vitest.config.ts:12-14`, `vitest.config.e2e.ts:10`) | `8ce2d58` | #2 |
| `.nvmrc` com `24`, e o workflow `Qualidade`, que lê a versão dele (`.github/workflows/check.yml:46-48`) | `5b33eb2` | #2 |
| `/.codegen-tmp/`, `/scripts/__pycache__/` e `/coverage/` no `.gitignore` (`.gitignore:41-43`) | `53ebbf7` | #2 |
| `typecheck` (`tsc --noEmit`), `check:context` e `check`, que roda lint, typecheck, testes, `check:context` e build nessa ordem (`package.json:24`, `:31-32`) | `410d295` | #3 |

O check `Qualidade / check` roda `npm ci`, `npm run check` e o e2e (`.github/workflows/check.yml:50-57`). Ele deixa de fora o `check:all` e, com ele, o Python, até a #7 (`.github/workflows/check.yml:10-11`). O [fluxo](../../docs/development/workflow.md#check) diz como rodar o mesmo antes da PR.

## Racional

- **A maior parte veio do starter.** O nome do pacote e o Hello World (#9) mostram o starter do NestJS por baixo. oxlint, prettier, vitest e o `nest build` vieram com ele (inferido; confirmar).
- **O `ignoreDeprecations` é obrigatório nesta config.** Numa cópia do `tsconfig.json` sem ele, o tsc 6.0.3 recusa a config com TS5107: `moduleResolution=node10` "is deprecated and will stop functioning in TypeScript 7.0". Manter `commonjs` com a resolução `node` preserva a saída CommonJS que `node dist/main` roda (inferido; confirmar).
- **Imports sem extensão.** No `0c8e760`, os geradores emitiam imports com o sufixo `.js` (`0c8e760:scripts/generate-marketo-resources.py:73`), mas nenhum arquivo commitado o tinha. O `a967f26` tirou o sufixo dos geradores. A resolução `node` aceita o import sem extensão, e alinhar o gerador ao código commitado foi o motivo (inferido; confirmar).
- **O prettier faz parte do contrato gerado.** O `check:*` compara os arquivos commitados com a saída gerada já formatada (`scripts/marketo_codegen.py:115-121`). Outra versão ou outra config do prettier mudaria a saída esperada (inferido; confirmar).
- **Python só com a biblioteca padrão.** Os geradores não pedem `pip install`, só um `python3` no PATH. O histórico não diz por que Python, e não TypeScript (inferido; confirmar).

## Alternativas consideradas

O histórico não registra que alternativas foram avaliadas.

| Opção | Por que não |
| --- | --- |
| Jest, o runner clássico do Nest | vitest já estava no `0c8e760`, com as duas configs, e veio do starter (inferido; confirmar) |
| ESLint | oxlint já estava no `0c8e760` e veio do starter (inferido; confirmar) |
| Geradores em TypeScript | Não há registro. Um gerador em Python só com a biblioteca padrão roda sem instalar nada além do `python3` (inferido; confirmar) |
| Builder swc | Não está instalado, e o tsc já faz o build (inferido; confirmar) |
| Migrar para `moduleResolution: "node16"` ou `"bundler"` no TypeScript 6 | Pediria rever o formato de módulo e a forma dos imports que os geradores emitem, em todo o código gerado (inferido; confirmar) |
| pnpm ou yarn | O projeto nasceu com o lockfile v3 do npm, e o CI roda `npm ci` (inferido; confirmar) |

## Consequências

- **Mais fácil**: um `npm ci` instala tudo do lado TypeScript, e os geradores só pedem um `python3` e o prettier que esse `npm ci` instala, sem dependência de pip.
- **Mais difícil**:
  - **o Python não tem versão fixada** e o CI ainda não roda os geradores (`.github/workflows/check.yml:10-11`), então nada pega um Python velho demais;
  - **o TypeScript 7 pede uma migração.** O tsc diz que `moduleResolution=node10` vai parar de funcionar no 7.0. Subir de versão pede trocar a resolução de módulos, e talvez a forma dos imports gerados (inferido; confirmar);
  - **os geradores não escolhem o Node pelo `.nvmrc`.** Antes de rodar o prettier, eles põem na frente do `PATH` o primeiro diretório com um `node`: `NODE_BIN`, depois `~/.nvm/versions/node/*/bin` em ordem reversa de nome, `/usr/local/bin` e `/opt/homebrew/bin` (`scripts/marketo_codegen.py:68-77`). Eles também pulam o prettier em silêncio quando `node_modules/.bin/prettier` não existe (`:81-83`), e um clone sem `npm ci` vê tudo como defasado (#7);
  - **o `format` não cobre tudo e nada o confere.** Ele só escreve `src` e `test` (`package.json:10`), e o `npm run check` não roda `prettier --check`. Em `fb4a804`, o `prettier --check` nesse escopo falhava em 4 arquivos: os 3 do Hello World do starter (`src/app.controller.ts`, `src/app.controller.spec.ts` e `src/app.service.ts`) e o `src/asset/asset.module.ts` (#9);
  - **o lockfile marca o faker como dev**, o que a [ADR 0007](0007-faker-factories-with-overrides-and-seed.md) e a #9 tratam;
  - **o script `deploy` e o `@nestjs/mau` são sobras do starter** (#9).

## Relacionados

- [ADR 0004: O Swagger como fonte única, com o código gerado commitado](0004-swagger-as-single-source-with-committed-generated-code.md), que os geradores Python executam
- [ADR 0005: NestJS sobre Express, com um módulo por tag](0005-nestjs-express-one-module-per-tag.md), que o `nest build` compila
- [ADR 0006: DTOs como interfaces TypeScript](0006-dtos-as-typescript-interfaces.md), que o typecheck confere
- [ADR 0007: Factories faker com overrides e seed](0007-faker-factories-with-overrides-and-seed.md)
- [ADR 0002: Enforcement soft do loop no GitHub Free](0002-soft-enforcement-on-github-free.md), cuja camada 1 inclui o `Qualidade / check`
- [Pattern: Gerar e conferir](../knowledge/patterns/generate-and-check.md)
- [O fluxo de desenvolvimento](../../docs/development/workflow.md#check)
- [Feature: Registro retroativo do projeto](../intent/feature-retroactive-record.md)
- Os geradores no layout antigo (#7) e as sobras do starter (#9)

## Status

- **Criado**: 2026-09-25 (Fase: Build), registro retroativo de `0c8e760`..`fb4a804` (#4)
- **Status**: Accepted
