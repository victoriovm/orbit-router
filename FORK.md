# FORK.md — Modificações do Orbit Router

Este repositório é um **fork** do [9router](https://github.com/decolua/9router) (autor original: `decolua`).
O Orbit Router mantém sincronia periódica com o upstream via merges (`Merge branch 'master' of https://github.com/decolua/9router`)
e sobrepõe, por cima disso, o conjunto de modificações descrito neste documento.

> **STATUS (2026-10-24): as seções §7 (catálogo models.dev), §8 (streaming/Muse/tradutores), as métricas de tok/s da
> §9 e a §10 inteira (build e empacotamento) foram REVERTIDAS** para reduzir conflitos de merge com o upstream.
> Cada uma dessas seções traz um aviso no topo indicando o estado atual. O delta caiu de 263 para 214 arquivos.
> Veja [`REMOVE.md`](./REMOVE.md) §11 para o registro completo da limpeza.

## Como este documento foi produzido

O delta abaixo não foi levantado por leitura de commits isolados, e sim por **diff direto contra o último commit do upstream
que já está mergeado neste repositório**:

```bash
# Baseline: último commit do 9router oficial presente no histórico deste fork
git log --oneline -1 f39d8f07     # f39d8f07 — "# v0.5.109 (2026-10-23)"

# Delta completo do fork (situação ORIGINAL, antes da limpeza de 2026-10-24)
git diff f39d8f07 0636b757 --stat
```

| Métrica | Original (HEAD `0636b757`) | Após limpeza |
| --- | --- | --- |
| Baseline (upstream mergeado) | `f39d8f07` — `# v0.5.109 (2026-10-23)` | idem |
| Arquivos alterados | 263 | **214** |
| Linhas | +12.651 / −15.571 | +10.362 / −15.398 |
| Arquivos novos | 69 | ~60 |
| Arquivos removidos | 38 | 32 (só os arquivos de locale) |
| Commits do fork (não-merge) | 59 (todos de `Victorio`) | idem |

Os números da coluna "Original" descrevem o estado em que este documento foi escrito; a coluna "Após limpeza" é o
estado atual do working tree (a limpeza ainda não foi commitada).

Todas as verificações de linha de base abaixo podem ser reproduzidas com `git diff f39d8f07 -- <caminho>`.

> **Nota sobre alterações que o upstream absorveu depois:** commits do fork cujo efeito já foi substituído pelo próprio
> 9router oficial (ex.: o suporte a *agentrouter*, que o upstream depois removeu no expurgo de provedores) **não** são
> contados como modificação. Eles aparecem no histórico, mas o `git diff f39d8f07 HEAD` correspondente é vazio — ou seja,
> não há resíduo no estado atual do código.

---

## 1. Rebranding para "Orbit Router"

O fork se apresenta como um produto próprio, com identidade visual violeta substituindo a paleta coral/laranja original.

- **Nome e configuração central** — `src/shared/constants/config.js`: `APP_CONFIG.name` passa de `"9Router Proxy"` para
  `"Orbit Router"`; adiciona-se `APP_CONFIG.port: 20128` (substitui o antigo `UPDATER_CONFIG.appPort`); o bloco
  `UPDATER_CONFIG` inteiro foi **removido**.
- **Assets de marca** — novos `public/brand/orbit-router-mark.svg` (badge violeta com órbitas cruzadas) e
  `public/brand/orbit-router-wordmark.svg`. O mark é usado no login, na landing, na sidebar e no `FlowAnimation`;
  o wordmark existe mas não é referenciado por nenhum componente.
- **Ícones** — `public/favicon.svg`, `public/icons/icon-192.svg` e `public/icons/icon-512.svg` reescritos com a mesma
  arte orbital (gradiente `#A78BFA → #7C3AED → #4C1D95`); `src/app/favicon.ico` foi **deletado**.
- **Metadados** — `src/app/layout.js`: título `"Orbit Router - AI Infrastructure Management"` e `themeColor` `#6D28D9`;
  `src/app/manifest.js`: `name`/`short_name` renomeados e `theme_color` `#6D28D9`.
- **Tema global** — `src/app/globals.css` (~238 linhas alteradas): escala `--color-brand-*` migra de coral (`#E56A4A`)
  para violeta (`#7c3aed`/`#3b0764`), incluindo `--shadow-warm`, `--shadow-focus`, `::selection`, scrollbars e keyframes.
  As animações de topologia antigas (`topology-router-pulse`, `topology-edge-kame`, `.react-flow-controls-custom`…) foram
  removidas e substituídas pelos pares `provider-routing-glow` / `.provider-routing-active` (verde/ciano) e
  `.orbit-routing-active` (violeta).
- **Landing page** — `src/app/landing/**`: recolorização completa para `brand-500/600` e renomeação de textos
  (`9Router` → `Orbit Router`) em `page.js`, `Navigation.js`, `HeroSection.js`, `FlowAnimation.js`, `HowItWorks.js`,
  `GetStarted.js`, `Footer.js` e `AnimatedBackground.js`.
- **Login** — `src/app/login/page.js` usa o mark SVG no lugar do `<h1>9Router</h1>` e remove a dica
  `"Default password is 123456"`.
- **Substituição de marca em runtime** — `src/i18n/runtime.js` ganha `applyBrandName()`, que aplica
  `text.replaceAll("9Router", APP_CONFIG.name)` em **todo** resultado de `translate()`, inclusive em inglês. Isso mascara
  as strings antigas ainda presentes nos arquivos de tradução sem tocar em cada chave.

### i18n reduzido a 3 idiomas

`src/i18n/config.js` passa de 35 locales para **`["en", "es", "pt-BR"]`** (`DEFAULT_LOCALE = "en"`), com
`normalizeLocale()` reescrito para um mapa genérico de prefixo de idioma (`pt` → `pt-BR`, `es` → `es`, `en` → `en`).

Foram **deletados 32 arquivos** de `public/i18n/literals/` (ar, bn, cs, da, de, el, fa, fi, fr, he, hi, hu, id, it, ja, km,
ko, nl, no, pl, pt-PT, ro, ru, sv, th, tl, tr, uk, ur, vi, zh-CN, zh-TW). Sobraram `es.json` e `pt-BR.json`, ambos
estendidos com as chaves novas (Home, Models, passkeys, atualização, etc.). O locale continua sendo persistido apenas por
cookie (`LOCALE_COOKIE = "locale"`), via `POST /api/locale`.

### Locais onde o branding antigo permanece

O rebranding é cosmético/parcial. Ainda dizem `9router` (minúsculo, portanto **não** alcançado pelo `applyBrandName`):
`GITHUB_CONFIG` em `src/shared/constants/config.js` (changelog e donate apontam para `decolua/9router` e `9router.com`),
o `README.md`, os nomes de pacote (`package.json` = `9router-app`, `cli/package.json` = `9router`), o caminho
`npx 9router` / `~/.9router` em `GetStarted.js`, a dica de reset de senha no login, e chaves de API default
(`sk_9router`) nas telas de CLI Tools. Componentes promocionais do upstream seguem no repositório, porém órfãos:
`NineRemotePromoModal.js`, `NineRemoteButton.js`, `HeaderLanguage.js`, `DonateModal.js`, `ChangelogModal.js`.

---

## 2. UI e layout

### Sidebar e conteúdo "flutuantes"

- `src/shared/components/Sidebar.js` (líquido −237/+56): o `<aside>` deixa de ser uma coluna colada na borda e vira um
  cartão flutuante (`m-3 rounded-2xl border bg-vibrancy shadow-[var(--shadow-elev)]`, `lg:m-4`), com o logo trocado pelo
  mark SVG. Os "traffic lights" de macOS foram removidos.
- `src/shared/components/layouts/DashboardLayout.js`: o conteúdo principal também virou cartão flutuante
  (`rounded-2xl` + `shadow-[var(--shadow-elev)]`).
- **Navegação reestruturada** em `homeItems` / `routerItems` / `debugItems` / `systemItems`, com `isActive()` reescrito
  (match exato em `/dashboard` e exclusão de `/providers/models` da rota `/providers`). Entradas novas: **Home**
  (`/dashboard`, ícone `home`) e **Models** (`/dashboard/providers/models`, ícone `deployed_code`). Ícones trocados:
  Endpoint `api` → `key`, Combo `layers` → `merge_type`, Token Saver `savings` → `money_bag`, CLI Tools `terminal` → `code`.
- **Removido da Sidebar**: os links promocionais `9Remote` (`9remote.cc`, com badge "HOT") e `9English`, todo o fluxo de
  checagem de versão npm (`/api/version`, banner "Update now", `ManualUpdatePanel`, overlay "Server Disconnected") e o
  botão de shutdown.

### Header e menu de usuário

- `src/shared/components/Header.js`: removidos `DonateModal` (com o botão rosa de doação), `ThemeToggle` e
  `HeaderLanguage`; barra de busca reestilizada (`h-9 rounded-xl` + `focus:ring-4`); nova entrada de página para
  `/dashboard/providers/models`; `/dashboard` passa a se chamar "Home".
- `src/shared/components/HeaderMenu.js`: gatilho passa de `grid_view` para `person` + cabeçalho "Local User"; o menu
  agora contém somente **Settings** e **Logout**. Saíram "Change Log", "Theme" e o **Shutdown** ("Close Proxy").

### Feedback ao usuário: fim dos `alert()`

Cerca de 33 chamadas de `alert()` foram trocadas por `useNotificationStore.getState().error(...)` (toasts), em telas como
Combos, Translator, Media Providers, Providers (`CompatibleModelsSection`, `[id]/page.js`), `PricingModal` e no novo
`AddApiKeyModal`.

### Outras telas

- **Página nova "Models"** — `src/app/(dashboard)/dashboard/providers/models/page.js` (571 linhas): tabela com todos os
  modelos do catálogo (id, provedor, saúde, toggle de publicação, teste individual), cards de estatística
  (Total / Visíveis em `/v1/models` / Ocultos / Funcionando), filtros por provedor e status, paginação e
  "Test all models" com concorrência 4 e auto-ocultação dos que falham.
- **Profile** — `src/app/(dashboard)/dashboard/profile/page.js`: cards ganham cabeçalho padronizado
  (`SettingsCardHeader.js`, novo) e entram os cards **Application Update** (Git), **Passkeys** e **Model Catalog**.
  Saíram o botão de shutdown e o uso do componente `LanguageSwitcher` (substituído por dropdown inline).
- **`PricingModal`** — `-w` mostra apenas +30/−4: as ~440 linhas de diff são reindentação. O ganho funcional é
  confirmação via `ConfirmModal` no "Reset to Defaults" (+ `DELETE /api/pricing`) e toasts no lugar de `alert()`.
- **Fluxo OAuth manual** — `OAuthModal.js`, `ZedAuthModal.js`, `KiroSocialOAuthModal.js`, `XiaomiMimoAuthModal.js`:
  o fork **abandonou o popup/iframe automático**. A URL de autorização agora é exibida no card de espera com botão
  "abrir" (`window.open(..., "_blank", "noopener,noreferrer")`), e o retorno continua chegando por
  `postMessage`/`BroadcastChannel`/`localStorage` ou colando a callback URL. Isso evita bloqueio de popup e remove os
  problemas de iframe.
- `src/shared/components/Card.js`: novas props `iconClassName` / `iconContainerClassName` e correção de `min-w-0`.

---

## 3. Passkeys / WebAuthn (feature exclusiva do fork)

Login sem senha com WebAuthn, usando `@simplewebauthn/server` e `@simplewebauthn/browser` (novas dependências).

- **Persistência** — nova tabela `passkeys` em `src/lib/db/schema.js` (`credentialId TEXT PRIMARY KEY`, `publicKey`,
  `counter`, `transports`, `deviceType`, `backedUp`, `name`, `createdAt`, `lastUsedAt`, índice `idx_passkeys_created`),
  `SCHEMA_VERSION` elevado para 2 e migração versionada `src/lib/db/migrations/002-passkeys.js`.
  Acesso via `src/lib/db/repos/passkeysRepo.js`. Passkeys entram em `exportDb()`/`importDb()`, então sobrevivem a
  backup/restore (a chave pública e o counter são preservados).
- **Helpers** — `src/lib/auth/passkeys.js`: store de desafios em memória em `globalThis.__orbitPasskeyChallenges`
  (single-use, TTL 300s, cookie `passkey_challenge` httpOnly/`sameSite=strict` restrito a `/api/auth/passkeys`),
  `getPasskeyRequestContext(request)` exigindo que o host do `Origin` bata com o `Host` e obrigando HTTPS fora de
  loopback (`localhost`, `127.0.0.1`, `::1`).
- **Endpoints novos** — `GET /api/auth/passkeys` (lista), `DELETE /api/auth/passkeys/[id]`,
  `POST .../register/options`, `POST .../register/verify`, `POST .../authenticate/options`,
  `POST .../authenticate/verify`. RP configurado como `rpName: "Orbit Router"`, `rpID` = hostname do dashboard,
  usuário único local (`orbit-router-local-user`), `residentKey` e `userVerification` obrigatórios.
- **Autorização** — em `src/dashboardGuard.js`, `isPasskeyManagementRoute` exige sessão válida do dashboard ou token CLI
  para registrar/listar/deletar; apenas `.../authenticate` é público (necessário para logar). Não há re-digitação de
  senha para registrar uma passkey. O `authenticate/options` ainda respeita o rate limit de login e recusa o fluxo quando
  o modo SSO/OIDC/SAML está ativo.
- **UI** — botão "Continue with passkey" no `src/app/login/page.js` (com divisor "Or") e card "Passkeys" no profile
  (adicionar/excluir, com `window.confirm` na remoção; o botão fica desabilitado se "Require login" estiver desligado).
- **Testes** — `tests/unit/passkeys-auth.test.js` + casos em `db-migration-chain`, `auth-status` e `dashboard-guard`.

---

## 4. Sessão do dashboard com renovação deslizante

`src/lib/auth/dashboardSession.js` foi reescrito para manter o usuário logado enquanto ele usa o painel:

- `SESSION_COOKIE_MAX_AGE_SEC = 30 dias`, `SESSION_REFRESH_AFTER_SEC = 24 horas`.
- O segredo JWT passou a ser lido de forma tardia (`getSecret()`, invalidado pelo mtime do arquivo `jwt-secret`) em vez
  de congelado no import.
- Novo `refreshDashboardSessionIfStale(response, request, session)`: se `iat` for mais antigo que 24h, re-assina o token
  copiando todas as claims não reservadas e re-emite o cookie `auth_token`. Ou seja: **renovação a cada 24h de uso**,
  encerrando apenas por logout explícito ou 30 dias de inatividade.
- `src/dashboardGuard.js` aplica essa renovação de forma best-effort no ramo `/dashboard`.
- `GET /api/auth/status` ganhou `hasPasskeys` e ajusta `displayName`/`loginMethod` (`"Passkey"`) quando a sessão veio de
  passkey.
- Testes: `tests/unit/dashboard-session-sliding.test.js` (janela de 24h, loop de 45 dias preservando claims,
  expiração por 30 dias de inatividade), `dashboard-guard.test.js` e `auth-status.test.js`.

---

## 5. Atualizador baseado em Git (substitui o updater npm)

O fork **removeu completamente** o auto-update por npm e o trocou por um fluxo Git + build + PM2.

**Removido:**
- `src/lib/appUpdater.js` (200 linhas) e `src/lib/updater/updater.js` (235 linhas).
- Rotas `src/app/api/version/route.js`, `src/app/api/version/update/route.js` e `src/app/api/version/shutdown/route.js`.
- `UPDATER_CONFIG` em `src/shared/constants/config.js`; botão de shutdown no profile, `HeaderMenu` e `Sidebar`.
- No CLI: `cli/cli.js` perdeu `checkForUpdate()`, `compareVersions`, `INSTALL_CMD_LATEST`, o menu "Update to vX" e a flag
  `--skip-update`; `cli/scripts/build-cli.js` deixou de copiar o diretório do updater; `cli/src/cli/tray/autostart.js`
  removeu `--skip-update` do plist macOS, do VBS do Windows e do `.desktop` do Linux.

**Adicionado:**
- `src/lib/gitUpdate.js` (novo, 298 linhas): resolve o repo via `git rev-parse --show-toplevel`, opcionalmente
  `git fetch --prune`, e reporta branch, upstream, `ahead`/`behind`, `dirty` e `updateAvailable`. Bloqueia a atualização
  com mensagem explícita em working tree sujo, branches divergentes ou update já em andamento. `startGitUpdate()` spawna
  um worker **destacado** (`detached: true`) com payload em base64url. Detecta worker morto por staleness
  (1h total / 5min de heartbeat / 30s de boot) e reconcilia a operação após o restart do PM2.
- `scripts/git-update-worker.mjs` (novo, 202 linhas): publica o primeiro estado *antes* de qualquer I/O, roda
  `git pull --ff-only`, resolve `HEAD`, verifica `bun --version`, executa `bun run build:bun` (timeout 30min) e por fim
  `pm2 restart <processo>`. O `buildEnv()` limpa variáveis `__NEXT_PRIVATE*` / `__NEXT_PROCESSED_ENV` para evitar
  `TypeError: generate is not a function` no build.
- `GET`/`POST /api/version/git-update` (novo): `GET` retorna status (`?refresh=0` pula o `fetch`), `POST` exige
  `NODE_ENV=production`, devolve 403/409 conforme o caso e 202 ao iniciar. Registrado em `ALWAYS_PROTECTED` no
  `dashboardGuard.js`.
- `GitUpdateCard.js` (novo, 285 linhas): mostra branch/commit local e remoto, fases (starting/pulling/building/done/
  error), avisos de "up to date", bloqueio e falha, e os botões "Check for updates" / "Update now" (com `ConfirmModal`).
  Polling de 2500ms durante a execução e 800ms na fase inicial; recarrega a página 1500ms após o sucesso.
- Nova variável de ambiente **`PM2_PROCESS`** em `.env.example` (default `DEFAULT_PM2_PROCESS = "9router"`).

A atualização continua **manual/acionada pelo usuário** — não há cron de auto-update.

---

## 6. Provedores

### 7 provedores novos

| Provedor | Registro | Id / alias | Base URL | Observações |
| --- | --- | --- | --- | --- |
| Vultr | `vultr.js` | `vultr` / `vultr` | `api.vultrinference.com/v1` | Quirk `requireMaxTokens: true` |
| Phoenix Grove | `phoenix-grove.js` | `phoenix-grove` / `pgs` | `api.pgsgrove.com/v1` | `passthroughModels` |
| Novita | `novita.js` | `novita` / `nov` | `api.novita.ai/openai` | Reintroduzido com URL nova (`/openai/…`) |
| Modal | `modal.js` | `modal` / `modal` | por conexão (`baseUrls`) | Multi-endpoint, executor próprio |
| RunAnywhere | `runanywhere.js` | `runanywhere` / `runa`, `wally` | `inference.runanywhere.ai/v1` | `retry: {429: 2}` |
| Verboo Code | `verboo-code.js` | `verboo-code` / `vc` | `code.verboo.ai/router/v1` | `passthroughModels` |
| Digital Ocean | `digital-ocean.js` | `digital-ocean` / `do` | `inference.do-ai.run/v1` | `passthroughModels` |

Com os respectivos logos em `public/providers/`. O registro `open-sse/providers/registry/index.js` ganhou 7 entradas
(141 → 148) e teve os índices `p1xx` renumerados para manter unicidade.

### Modal: roteamento multi-endpoint

O caso mais elaborado. Uma conexão Modal possui **vários endpoints** (`providerSpecificData.baseUrls`, um por app/workspace):

- `open-sse/executors/modal.js` (novo): `ModalExecutor` escolhe o endpoint que realmente hospeda o modelo pedido
  (`modalEndpointCandidates` / `modalConnectionServesModel`) e só faz hop para outro endpoint quando o erro é
  classificado como "modelo não servido", reescrevendo o campo `model` para o id do catálogo
  (`resolveModalUpstreamModelId`). Também normaliza tokens colados como `"Authorization: Bearer …"`.
- `open-sse/services/modalModels.js` (novo, 422 linhas): descoberta de modelos com persistência de
  `modelBaseUrls` / `modelUpstreamIds` na conexão. `buildModelNotServedResponse` gera o erro que ativa a regra
  `noFallback` (ver §7).
- `src/sse/services/auth.js` passa a **pular contas Modal** que não hospedam o modelo pedido, evitando que um fallback
  de cota caia numa conta que responderá com outro modelo.
- UI: `EndpointUrlsInput.js` (novo, 102 linhas) com linhas repetíveis de URL; `AddApiKeyModal` / `EditConnectionModal`
  ganham o formulário Modal; `bulkAdd.js` aceita o formato `nome|apiKey|url1,url2`; `providerNormalization.js` funde
  `baseUrls` e remove o `baseUrl` legado; `providerSpecificData` seguro em `/api/providers/client` ganhou `baseUrls`.
- Saúde do provedor: `health: { cooldownMs: 30min, disableAfterStrikes: 3 }` — ver §7.

### Cline → "Cline Free"

- `open-sse/providers/registry/cline.js`: nome de exibição `"Cline Free"`, categoria `oauth` → `freeTier`, e a lista
  estática de modelos foi **zerada** (`models: []`). O slug continua `cline` (alias `cl`).
- `open-sse/services/clinepassModels.js`: `resolveClineModels()` deixou de exigir credenciais e agora monta o catálogo a
  partir de **duas fontes públicas** (`/api/v1/ai/cline/models`, filtrando ids `:free`, e
  `/api/v1/ai/cline/recommended-models`), com merge first-writer-wins e metadados reais de contexto/capacidades.
- `open-sse/shared/clineAuth.js`: passa a se passar pelo CLI real — `User-Agent: Cline/3.0.66`, `X-PLATFORM: cli`,
  `X-CLIENT-TYPE: cline-cli` (antes enviava User-Agent `9Router`).
- `open-sse/services/tokenRefresh/providers.js`: `refreshClineToken` ganha até 3 tentativas com 5s de intervalo
  (`CLINE_REFRESH_ATTEMPTS` / `CLINE_REFRESH_RETRY_DELAY_MS`).

### Outros ajustes de provedor

- `public/providers/opencode-zen.png` adicionado — era só o logo que faltava para o provedor OpenCode Zen que já existia
  no upstream, não um provedor novo.
- `provider-icons.test.js` (novo) passa a garantir, por teste, que todo provedor visível tem PNG resolvível — o bug de
  ícone caindo no tile de texto já ocorreu duas vezes.

---

## 7. Capacidades, saúde de contas e catálogo de modelos

> **PARCIALMENTE REVERTIDA (2026-10-24).** O **catálogo models.dev puxado de hora em hora** (subseção
> "Catálogo models.dev puxado de hora em hora", `src/lib/modelCatalog/pull.js`, `GET/POST /api/models/catalog-pull`,
> `src/instrumentation.js` e o card no profile) foi **removido** — `src/lib/modelCatalog/` voltou a conter apenas
> `sync.js`, do upstream. O flag `MODEL_CATALOG_PULL` deixou de existir.
> As demais subseções (`contextKnown`, política de saúde, `noFallback`, `/v1/models` sem chave e enriquecido) **permanecem**.

### Flag `contextKnown` e `context_misconfig`

`open-sse/providers/capabilities.js`: novo `resolveModelCapabilities(provider, model)` que retorna
`{ caps, contextKnown }`. Cada etapa de fallback (match exato, padrão de família, limites de provedor) reporta
`contextKnown: true`; apenas o piso genérico de 200k retorna `false`, sinalizando que a janela é um **palpite**.
`/api/v1/models` consome isso: sempre emite `context_length` e marca `context_misconfig: true` quando o valor é chute.
`getCapabilitiesForModel` continua existindo como wrapper. O `findModel` de `providerModels.js` também passou a remover
sufixo `"(level)"` antes de buscar no registro.

### Política de saúde declarada pelo provedor

- `open-sse/providers/schema.js` documenta `transport.health: { cooldownMs, disableAfterStrikes }`.
- `src/sse/services/auth.js` lê essa política (`providerHealthPolicy`) e, em `markAccountUnavailable`, eleva o cooldown
  ao valor do provedor, incrementa `failureStrikes` e **desativa a conta** após o número de falhas configurado
  (`"Disabled after N failures in a row — last: …"`). `clearAccountError` zera o contador no sucesso, e
  `connectionsRepo.resetHealthStateOnActivation` também reseta quando a conexão é reativada.

### Erros que não devem penalizar a conta

`open-sse/config/errorConfig.js` ganhou o flag `noFallback: true`, aplicado à regra
`"is not served by any configured endpoint"`. A resposta de `accountFallback.js` é
`{ shouldFallback: false, cooldownMs: 0 }` — um erro de digitação de modelo no cliente não deve "estacionar" contas
saudáveis nem contar strike.

### Catálogo models.dev puxado de hora em hora

- `src/lib/modelCatalog/pull.js` (novo, 127 linhas): baixa `https://models.dev/catalog.json` **sem chave** (com ETag /
  `if-none-match`), grava em `DATA_DIR/models-dev-catalog.json` + sidecar de metadados; intervalo de 1h, delay inicial de
  60s, retry de 10min após falha. Agendado em `src/instrumentation.js` via `startModelCatalogPull()` e desativável com
  **`MODEL_CATALOG_PULL=off`**. É separado do `sync.js` pré-existente (que usa `models.dev/api.json` com
  `MODEL_CATALOG_SYNC=off`).
- Rotas novas: `GET/POST /api/models/catalog-pull` (status / forçar agora) e `GET /api/models/catalog`
  (catálogo do dashboard com cache TTL de 30s, stale-while-revalidate de 300s, `?fast=1` e header `X-Cache`).
- Card "Model Catalog" no profile, com "Last updated" e botão de refresh (polling de 60s).

### `/v1/models` sem chave e enriquecido

- `src/dashboardGuard.js`: `PUBLIC_CATALOG_PATHS = ["/v1/models", "/api/v1/models"]` + `isPublicCatalog()` liberam o
  catálogo de modelos sem API key (sub-rotas incluídas), antes do gate de chave de LLM.
- `src/app/api/v1/models/route.js` (~240 linhas alteradas): novo campo **`owned_by_name`** (rótulo de dono não abreviado,
  aplicado também a `Combo`), suporte a `disabled` / `includeDisabled`, nomes de provider nodes customizados, resolução
  paralela por provedor com `withTimeout(…, 3500)`, modo `fast`, resolvers com cache e inclusão de provedores sem auth.
- `src/lib/modelsCount.js` + `GET /api/models/count`: contagem barata persistida em `DATA_DIR/models-count.json`
  (frescor de 60s, primeira execução usa tabelas locais em `fast: true` e atualiza em background).
- `open-sse/providers/pricing.js`: `FREE_MODEL_SUFFIXES = [":free"]` somado ao namespace `cline-free/`, para que
  modelos como `qwen/qwen3.8-27b:free` sejam cobrados como $0.

---

## 8. Streaming, Muse Spark e tradutores

> **REVERTIDA (2026-10-24).** Esta seção inteira não descreve mais o código atual: todos os arquivos citados
> foram revertidos ao upstream. Saíram os terminais de abort (`buildAbortedChatTerminalBytes`), o heartbeat SSE
> (`SSE_HEARTBEAT`), o `parseRetryAfterMs`/`MUSE_SPARK_*` do `runtimeConfig.js`, a sentinela `[DONE]` do Muse Spark,
> a instrumentação `markContentDelta`/`contentTiming`, as mudanças em `nonStreamingHandler`/`sseToJsonHandler`/
> `streamToJsonConverter`, o `normalizeToolChoice` e o skip de "synthetic user" no tradutor de Responses, o
> `failedCompletion` na resposta, o `ensureToolCallIds` e o cloak sempre-ativo do opencode.
> Testes removidos junto: `stream-abort-chat-terminal`, `translate-done-sentinel`, `retry-after-helper`,
> `openai-responses-failure-status`, `openai-responses-synthetic-user-skip`.
> **Mantido:** `ensureMaxTokens` (quirk do Vultr) segue em `paramSupport.js` — ele pertence ao §6, não a esta seção.

### Terminais de abort em SSE de chat

`open-sse/utils/responsesStreamHelpers.js` ganhou `buildAbortedChatTerminalBytes(sourceFormat)`: quando o upstream
desconecta no meio do stream (ECONNRESET, stall) antes de qualquer chunk terminal, o fork sintetiza um payload de erro
explícito — chunk OpenAI com `finish_reason: "error"` + `error.code = "stream_disconnected"`, ou evento `error` do
Anthropic para clientes Claude. O comentário no código explica o motivo: o `SessionRetry` do opencode via stream truncado
seguido de `[DONE]` e assumia sucesso, nunca refazendo a requisição. O terminal só é construído no caminho do Muse Spark.

### Recuperação de stream: heartbeat, TTFT e stall

- `open-sse/utils/streamHandler.js` (~179 linhas): `pipeWithDisconnect()` ganha `heartbeatMs`, `firstChunkTimeoutMs` e
  `surfaceMidStreamErrors`; `fireTimeout()` distingue "stream stall timeout" de "stream first-chunk timeout (ttft)".
  O controller expõe `isStalled()`, `stallError()`, `isClientGone()` e `lastError()`. Heartbeats são emitidos com
  `SSE_HEARTBEAT = ": ping\n\n"` (novo em `sseConstants.js`) para evitar que nginx/Cloudflare/NAT derrubem a conexão
  durante raciocínio longo sem tráfego. `finishDownstream()` fecha silenciosamente quando foi o cliente que saiu.
- `open-sse/config/runtimeConfig.js`: `SSE_HEARTBEAT_INTERVAL_MS` (15s), `MUSE_SPARK_CONNECT_TIMEOUT_MS` (120s),
  `MUSE_SPARK_RETRY_CONFIG` (`429: 2 tentativas, 2s`), `MAX_RETRY_AFTER_MS` (10s) e o novo
  `parseRetryAfterMs(headers)`, que entende `retry-after-ms`, `retry-after`, `x-ratelimit-reset-after` e
  `x-ratelimit-reset`.
- `open-sse/executors/base.js` ganha os hooks `getRetryConfig(model)` / `getConnectTimeoutMs(model)`, implementados em
  `opencode-go.js` e `opencode.js`. No `opencode-go`, um `Retry-After` acima do teto retorna `false`, vetando o retry para
  cair imediatamente no fallback de conta.

### Sentinela `[DONE]`

`open-sse/utils/stream.js`: no flush, se o stream é OpenAI e o modelo é Muse Spark, e nenhum `[DONE]` foi enviado,
o fork enfileira `data: [DONE]\n\n`. Motivo: Muse Spark via Responses não carrega `[DONE]` para repassar e clientes
baseados em AI-SDK ficavam pendurados. Clientes Claude não recebem — ali o encerramento é o próprio enquadramento de
eventos.

### Instrumentação de tempo de conteúdo (base do tok/s)

Ainda em `stream.js`, `markContentDelta(charLength)` registra `firstContentAt`, `lastContentAt`, `contentDeltaCount`,
`firstDeltaChars` e `totalOutputChars`, repassados como 4º argumento (`contentTiming`) do `onStreamComplete`.
Daí vem `generationMs = lastContentAt - firstContentAt`, que **exclui** eventos terminais, `[DONE]` e eventos de usage.

### Handlers e tradutores

- `nonStreamingHandler.js` (+141): quando um cliente Chat/Claude é roteado para um upstream Responses-only, o corpo
  `{object: "response"}` é achatado (`responsesToOpenAICompletion` / `responsesToClaudeMessage`), com
  `incomplete_details.reason === "max_output_tokens"` mapeando para `length`, tool calls prevalecendo sobre o motivo, e
  id sintético `item.call_id || item.id || call_${name}_${idx}`. O fallback SSE para Responses passou a usar
  `convertResponsesStreamToJson` em vez do parser de Chat.
- `sseToJsonHandler.js` deixou de emitir o `finish_reason: "incomplete"` inválido (`truncatedByMaxTokens` → `"length"`).
- `streamToJsonConverter.js`: trata `response.incomplete` como terminal e para de forçar `status: "completed"`, copiando
  o status real e `incomplete_details`.
- `translator/request/openai-responses.js` (+133): novo `normalizeToolChoice()` (Claude `any` → `required`, formatos de
  tool function normalizados), precedência de limite de saída (`max_output_tokens > max_completion_tokens > max_tokens`)
  e o **skip de "synthetic user"**: mensagens de usuário que só carregam `<system-reminder>`/`snip_id` são ignoradas
  quando já existe conteúdo real, pois um turno de usuário espúrio após tool results quebrava a cadeia autônoma de
  tool-calling do Muse Spark.
- `translator/response/openai-responses.js` (+52): `failedCompletion()` mapeia `response.failed` / `status: "failed"`
  para `finish_reason: "error"` preservando o usage, em vez do texto `[Error] …` com `stop` limpo.
- `translator/concerns/paramSupport.js`: `ensureMaxTokens()` preenche `max_tokens` a partir das capacidades quando o
  cliente não enviou nenhum (opt-in via `quirks.requireMaxTokens`, hoje Vultr).
- `translator/concerns/toolCall.js`: `ensureToolCallIds` normaliza `arguments` vazio/nulo para `"{}"`.
- `open-sse/executors/opencode.js`: `cloakOpencodeTools(body, true)` passa a ser chamado em **toda** requisição Responses
  (o tier gratuito devolve `FreeTierError` a menos que `bash` e `read` estejam presentes), e o registro de `opencode.js`
  ganhou um transporte `openai-responses` para `https://opencode.ai/zen/v1/responses`.

---

## 9. Uso, métricas e Home

> **PARCIALMENTE REVERTIDA (2026-10-24).** As **métricas de tok/s foram removidas**
> (`calculateTokensPerSecond`, `calculateStreamTokensPerSecond`, `serializeUsageMeta`, `tokensPerSecond`), incluindo a
> coluna `meta` gravada em `usageHistory` e o badge `tok/s` em `UsageStats.js`. O teste `usage-throughput.test.js` foi removido.
> **Mantido:** a Home (`HomePageClient`), o endpoint `/api/dashboard/overview` + `overviewRepo.js`, a captura de
> `pending`/`activeRequests`, o `ProviderTopology` reescrito e o redesenho de cards do `UsageStats`.

### Nova Home

- `src/app/(dashboard)/dashboard/page.js` deixou de renderizar `EndpointPageClient` + machineId e passou a renderizar
  `HomePageClient.js` (novo, 333 linhas).
- `HomePageClient` busca `/api/dashboard/overview` e `/api/models/count` em paralelo (timeouts de 8s via
  `AbortController`) e assina `EventSource /api/usage/stream`, mergeando apenas os campos realtime. Cards de
  Providers/Models/Requests/Tokens/In progress, saúde de provedores, requisições recentes e links rápidos.
- `HomeUsageChart.js` faz import dinâmico do `HomeUsageChartInner.js` para tirar o recharts do primeiro paint.

### Novo endpoint de overview

- `src/app/api/dashboard/overview/route.js` (`force-dynamic`) → `GET /api/dashboard/overview`, servido por
  `getDashboardOverview()` em `src/lib/db/repos/overviewRepo.js` (novo, 235 linhas): uma única rodada com conexões
  "slim" (sem `apiKey`/`providerSpecificData`), contadores de hoje agregados por SQL, até 6 requisições recentes
  deduplicadas, estimativa de contagem de modelos e gráfico de 7 dias vindo de `usageDaily`.
- `src/app/api/usage/stream/route.js`: parou de recalcular `getUsageStats()` a cada tick — envia apenas
  `getActiveRequests()` (mais `pending` num canal separado) e mantém um keepalive `: ping` de 25s.

### Tokens por segundo (tok/s)

- Persistido em `usageHistory.meta` via `saveUsageStats(...)` estendido com
  `latencyMs, generationMs, contentDeltaCount, firstDeltaChars, totalOutputChars`.
- `src/lib/db/repos/usageRepo.js`: `calculateStreamTokensPerSecond()` exige `contentDeltaCount >= 2` e **exclui o
  primeiro delta do numerador** (`generationTokens = tokens * (1 - firstRatio)`), devolvendo `undefined` para amostras
  buferizadas (`firstDeltaChars / totalOutputChars >= 0.5`) ou janelas curtas. `calculateTokensPerSecond()` cai no
  cálculo ponta-a-ponta para respostas não-streaming. Exibido como `{Math.round(tokensPerSecond)} tok/s` no card de
  requisições recentes (`UsageStats.js`, que migrou de tabela para lista de cards).

### ProviderTopology reescrito

`src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js` (~649 linhas) deixou de ser um grafo React Flow
(`@xyflow/react`, arestas com partículas, `ProviderNode`) e virou um cartão "Routing activity": linha do hub do
Orbit Router + até 4 provedores com estados `active` / `error` / `last` / `ready`, contagem de requisições ativas
derivada de `pending.byModel` e reordenação animada via FLIP (`element.animate`), respeitando
`prefers-reduced-motion`. As animações correspondentes no CSS foram trocadas (§1).

### Outros ajustes de UI de uso

- `src/app/(dashboard)/dashboard/usage/page.js`: o sistema de abas (Overview/Details/Logs via `?tab=`) foi removido em
  favor de uma view única com header e `SegmentedControl` de período.
- `OverviewCards.js`: formatação compacta com `Intl.NumberFormat` e abreviação acima de $1000.
- `ProviderLimits/index.js`: exclusão de conexão agora passa por `ConfirmModal` em vez de `window.confirm`.
- `ProviderLimits`, `UsageStats` e o gráfico passam a mesclar SSE com `data.X ?? prev.X`, para que o stream não
  sobrescreva os agregados vindos de `/api/usage/stats`.

---

## 10. Build e empacotamento

> **REVERTIDA (2026-10-24).** `package.json`, `next.config.mjs`, `scripts/copy-standalone-assets.mjs`,
> `custom-server.js`, `src/app/globals.css` (diretiva `source()`), `src/mitm/manager.js` e `.gitignore` foram
> revertidos ao upstream. O build padrão voltou a ser **webpack** (`next build --webpack`), sem Turbopack,
> sem `pruneRepoOnlyDirs()` e sem `requestTimeout = 0`. As 22 anotações `/* turbopackIgnore: true */` foram removidas.
> O texto abaixo é o registro histórico do que o fork fazia.

- **Turbopack como padrão** — `package.json`: `build` roda `next build` (Turbopack), com alternativas explícitas
  `build:webpack`, `build:bun` e `build:bun:webpack`; `postbuild:bun` adicionado. `description` passou a
  `"Orbit Router web dashboard"`.
- `next.config.mjs`: `outputFileTracingExcludes` cobre `logs`, `tests`, `docs`, `images`, `cli`, `.github`, `.vscode`;
  habilita `experimental.turbopackFileSystemCacheForBuild`; adiciona `recharts` a `optimizePackageImports`.
- `scripts/copy-standalone-assets.mjs`: novo `pruneRepoOnlyDirs()`, que remove diretórios exclusivos do repositório do
  bundle standalone. Motivo documentado no código: o tracer do Turbopack ignora `.gitignore` e copiava `logs/` (que
  acumula payloads de requisição/resposta capturados) para dentro do pacote publicado / imagem de container.
- `custom-server.js`: `server.requestTimeout = 0` ao escutar, para que o timeout padrão de 300s do Node não mate
  respostas SSE longas.
- Vários arquivos receberam comentários `/* turbopackIgnore: true */` em `existsSync`/`execFileSync` com caminho
  computado (`src/lib/db/paths.js`, `version.js`, `src/lib/headroom/detect.js`, `src/lib/pxpipe/*`,
  `src/lib/tunnel/**`, `src/mitm/manager.js`, `open-sse/utils/requestLogger.js`, `open-sse/executors/devin-cli.js`).
- `.gitignore`: acrescenta `.openclaude` e reposiciona `.scratch/`.
- `Dockerfile`, `docker-compose.yml` e `.github/` permanecem inalterados em relação ao upstream.

---

## 11. Testes

> **ATUALIZADO (2026-10-24).** Dos 25 arquivos de teste que o fork acrescentou, **6 foram removidos** por cobrirem
> features revertidas: `stream-abort-chat-terminal.test.js`, `translate-done-sentinel.test.js`,
> `retry-after-helper.test.js`, `openai-responses-failure-status.test.js`,
> `openai-responses-synthetic-user-skip.test.js` (§8) e `usage-throughput.test.js` (tok/s, §9).
> Restam **19**.

O fork acrescentou **19 arquivos de teste** (o diretório `tests/` já existia no upstream), cobrindo as features novas:

- Atualizador Git: `git-update.test.js`, `git-update-route.test.js`
- Modal: `modal-provider.test.js`, `modal-account-health.test.js`, `modal-account-reenable.test.js`
- Provedores novos: `phoenix-grove-vultr-novita-providers.test.js`, `runanywhere-provider.test.js`,
  `verboo-digital-ocean-providers.test.js`, `vultr-max-tokens.test.js`, `provider-icons.test.js`,
  `provider-model-discovery.test.js`, `provider-validate-public-models.test.js`
- Sessão/passkeys/overview: `dashboard-session-sliding.test.js`, `dashboard-guard.test.js`,
  `dashboard-overview.test.js`, `passkeys-auth.test.js`
- Catálogo/uso: `v1-models-context-misconfig.test.js`, `v1-models-no-auth.test.js`, `v1-models-owned-by-name.test.js`,
  `locale-config.test.js`

Testes do upstream também foram **ajustados** quando a semântica mudou — por exemplo,
`local-request-peer-trust-3294.test.js` passou a usar `/v1/chat/completions` em vez de `/api/v1/models` como sonda,
porque o catálogo agora é público e não distingue mais peer confiável de spoofado.

**Estado da suíte após a limpeza:** 24 arquivos falham, todos já falhando no baseline (issues pré-existentes do
upstream); **zero regressões** introduzidas. `git-update.test.js` e `opencode-free-tool-choice.test.js` passaram a
rodar em isolamento. O snapshot `golden-url-header.test.js.snap` foi regenerado para acompanhar o código do
"Cline Free" (que permanece).

---

## 12. Resumo por commit (agrupado)

Os 59 commits não-merge do fork cobrem exatamente os blocos acima. Cada linha lista os commits cujo efeito líquido
ainda está presente em `f39d8f07..HEAD`:

| Tema (§) | Commits |
| --- | --- |
| Home, ícones, doações/shutdown removidos (§2) | `a807633e`, `7a8ce1f6`, `d572bd54`, `ccd09774` |
| i18n reduzido a en/es/pt-BR (§1) | `8d4eeee9` |
| OAuth manual, sem popup/iframe (§2) | `482f847c`, `5bb901d1`, `2d8e437e`, `6fb0b670` |
| Atualizador Git (§5) | `920afd59`, `ec32a219`, `b7dff978`, `61af9c72`, `f162a77e`, `ceba6848`, `13a9adf2`, `f2725ebd`, `eb0841c5`, `45f02d51`, `dfe26dc5` |
| Provedores novos + Modal multi-endpoint (§6) | `f2e7f760`, `e99b140c`, `fd6cb618`, `9cf73a99`, `cbd9064e`, `f6ddd61c`, `d35a90d4` |
| Cline Free (§6) | `a25d436b`, `ab8fc5cb` |
| Model manager e descoberta de modelos (§6) | `e4a74810`, `ede5640e`, `0527e89e` |
| Catálogo models.dev e `/v1/models` (§7) | `019ec6fd`, `3071243d` |
| Throughput (tok/s) (§9) | `a22c9527`, `bc0382e7`, `69d5ebb8`, `727a01c4`, `70073a73` |
| Muse Spark / streaming / opencode / capacidades (§7, §8) | `3c93f298`, `b646490c`, `fef14fb6`, `58949040`, `30ea70e6`, `af862add` |
| Home rápida, overview, sessão e passkeys (§3, §4, §9) | `b5d2f237`, `d2ef4747`, `f88495be`, `98221702`, `43ababc5`, `5cf200ff`, `b5c9839d`, `e724b74f`, `55a44b07`, `29fef2d1` |
| Build Turbopack/bun (§10) | `c4184a2c` |
| **Superados pelo upstream — sem delta atual** | `51814a19`, `f253b525`, `fee40f46` |

Os commits `51814a19` ("feat: agentrouter support"), `f253b525` ("fix: agentrouter prefix") e `fee40f46`
("remove: agent router") pertencem ao histórico do fork, mas o upstream `decolua/9router` também removeu o provedor
`agentrouter` em seguida. O resultado é que `git diff f39d8f07 HEAD -- '*agentrouter*'` é vazio: não há resíduo, e por
isso esses commits não aparecem em nenhuma seção anterior. O mesmo vale para ajustes que o upstream absorveu depois.

Há ainda 10 commits de **merge** de `decolua/9router` no intervalo, que são a sincronização periódica com o upstream e
não introduzem modificações próprias.

---

## 13. Sincronizando com o upstream

Para atualizar a partir do 9router oficial:

```bash
git remote add upstream https://github.com/decolua/9router.git   # se ainda não existir
git fetch upstream
git merge upstream/master
```

Após o merge, para regerar este levantamento:

```bash
# Descobrir o novo baseline (último commit do upstream incorporado)
git log --oneline -1 upstream/master

# Rediffar
git diff <novo-baseline> HEAD --stat
```
