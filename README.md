[![status](https://img.shields.io/badge/status-prot%C3%B3tipo_implementado-facc15?labelColor=18181b)](#-como-rodar) ![node](https://img.shields.io/badge/node-%E2%89%A520.9-334155?labelColor=18181b) ![licen%C3%A7a](https://img.shields.io/badge/dados-locais-4ade80?labelColor=18181b)

# revai · plataforma

> **A skill `revai` com interface:** mesmo fluxo de 5 passos e mesmo contrato de dados (schema V2, Quality Gate, fix loop), agora com repos remotos e escolha/validação de harness local. Todo o resto do legacy ficou de fora.

A plataforma é um **host local para a skill** [`skill-version/revai`](./skill-version/revai): você cola a URL de um repo (branch, PR, MR, commit) **ou escolhe uma pasta local com o seletor nativo do sistema**, e o runner padrão da máquina — definido no primeiro setup (`01`) — executa a revisão sobre os changes. Acompanha os 5 passos ao vivo, recebe o relatório e resolve pelo fix loop: tudo em `127.0.0.1`, sem mandar nada para a nuvem.

---

## ⚙️ Como funciona

```mermaid
flowchart TD
    A[URL / pasta local] --> B[01 · resolve + acessibilidade]
    B --> C[02 · clone em ~/.revai/repos + checkout head]
    C --> D["revai.mjs diff --current → .revai/data/&lt;slug&gt;.patch"]
    D --> E[harness local executa a skill via stdin<br/>→ &lt;slug&gt;-review.json + &lt;slug&gt;-meta.json]
    E --> F["generate-review.mjs valida schema V2<br/>→ .revai/reviews/&lt;slug&gt;-review.html"]
    F --> G[05 · relatório na UI (Gate + findings)]
    G --> H[06 · fix loop: aplicar → testes → gate delta]
```

O **pipeline é o da skill** — a plataforma é orquestração e interface:

1. **Preparar clone** — resolve `github.com/org/repo/tree/branch`, `pull/482`, `merge-requests/12`, `@sha` ou pasta local; clona em cache `~/.revai/repos/<host>/<org>/<repo>`.
2. **Gerar patch** — roda `node revai.mjs diff --current` no clone (a própria skill detecta a base via `origin/HEAD` e `merge-base`), gerando `.revai/data/<slug>.patch`.
3. **Analisar mudanças** — o harness recebe **via stdin** um prompt com os caminhos da skill (`SKILL.md`, `references/rubric.md`, `references/stack-playbooks.md`), as regras do projeto (`.revai/rules.md` > `CODING_STANDARDS.md`/`CONTRIBUTING.md`) e o escopo do patch — e escreve os dois JSONs.
4. **Validar schema** — `node generate-review.mjs <slug> --no-open` valida contra o **schema V2 da skill**. Falha = nada é gerado = estado de erro na UI com a **mensagem real do script**.
5. **Montar relatório** — record + gate espelham `computeGate()` da skill; artefatos ficam em `~/.revai/reviews/<id>/` e o HTML da skill abre com um clique.

---

## 🖥️ Telas

| # | Tela | Rota | O que faz |
|---|------|------|-----------|
| 01 | Onboarding (`/onboarding`) | Detecta CLIs no PATH, valida com **checklist cronometrado** e define o **runner padrão** — a única superfície de gestão de harness da v1 |
| 02 | Nova review | `/new` | Cola URL/pasta **ou escolhe a pasta pelo diálogo nativo do sistema**, resolve e mostra card de acessibilidade + **"Continuar de onde parou"** |
| 03 | Configure | `/configure` | head/base com badge de commits, mini-bars por arquivo (lockfiles ignorados), regras detectadas, harness + modelo, estimativa de tempo |
| 04 | Running | `/running` | Stepper com os 5 passos, **log bruto via SSE**, timer, cancelamento com artefatos parciais |
| 05 | Relatório | `/report/:id` | Gate + criteria, lista + detalhe ("O que é" / "Por que importa" / correção proposta), filtros, Pular/Restaurar, **Copiar prompt**, atalhos J/K/S/C/F |
| 06 | Fix loop | `/fix/:id` | Fila de correções com apply → testes → **delta do Gate**; saídas: push `revai/fix-*`, download `.patch`, abrir no editor, descartar |
| 07 | History | `/` | Todas as reviews com resultado do Gate, filtros por repo/status/texto |
| 09 | Settings | `/settings` | Tema, branch base padrão, switches, **regras globais**, cache de clones + retenção, Acesso git (credential helper) |
| 10 | Estados | `/states` | Catálogo dos estados desenhados (vazio/carregando/erro/cancelado/passed) servido pelo catálogo real de erros da API |

> A 08 (`/harnesses`) do protótipo **não existe na plataforma v1** — a gestão de harnesses virou complexidade desnecessária: o runner padrão se define no onboarding e aparece nas telas 02/03 apenas como status. O modelo de invocation avançado fica no `~/.revai/harnesses.json`.

## ⌨️ Atalhos

| Tecla | Onde | Ação |
|-------|------|------|
| `Ctrl K` / `⌘K` | global | Command palette (ações + reviews recentes + colar URL) |
| `N` | global | Nova review |
| `T` | global | Alternar tema |
| `Ctrl ↵` | 03 | Iniciar review |
| `J` / `K` | 05 | Próximo / anterior finding |
| `S` | 05 | Pular / restaurar finding |
| `C` | 05 | Copiar prompt (`Fix CR-01 in the revai review of <slug>`) |
| `F` | 05 | Mandar o finding para o fix loop |
| `Esc` | global | Fechar palette |

---

## 🚀 Como rodar

**Pré-requisitos:** Node ≥ 20.9 (22+ recomendado), Git, e pelo menos um harness CLI instalado (ex.: `kiro-cli`, `claude`, `codex`, `opencode`). A skill fica junto — [`skill-version/revai`](./skill-version/revai) — e é descoberta automaticamente (ou via `REVAI_SKILL_DIR`).

```bash
# desenvolvimento (API :8797 + Vite :5173 com proxy)
npm install
npm run dev          # abre http://localhost:5173

# produção local (API + UI no mesmo :8797)
npm run build
npm start            # http://127.0.0.1:8797  (--open abre o navegador)
```

> ⚠️ **A UI depende do processo da API.** Se a página mostrar **"Servidor local offline"** (ou um `Failed to fetch` em alguma ação), o `npm start` não está rodando — ele deve permanecer vivo enquanto você usa a plataforma. O banner sumirá sozinho assim que a API responder.

Variáveis de ambiente:

| Var | Padrão | O que muda |
|-----|--------|------------|
| `REVAI_PORT` | `8797` | Porta da API/UI |
| `REVAI_HOME` | `~/.revai` | Diretório de dados (repos, reviews, settings) |
| `REVAI_SKILL_DIR` | `./skill-version/revai/skills/revai` | Onde estão os scripts da skill |

Scripts: `dev · build · start · typecheck · test`.

---

## 🤝 Contrato com a skill

Arquivos em `~/.revai`: `settings.json · harnesses.json · repos/<host>/<org>/<repo> · reviews/index.json · reviews/<id>/{record.json, review.json, meta.json, review.patch, review.html}`.

- **Schema V2** (`references/schema.md` da skill): severidades `critical|major|minor|trivial`, categorias `security|performance|stability|data-integrity`, status `open|resolved`; `proposedFix = {language, before[], after[]}`. (O campo `effort` do schema continua nos dados — a skill o exige — mas a UI não o exibe.)
- **Quality Gate** — espelho fiel de `computeGate()`: **fail só se houver `critical` aberto**; `security` entra como hotspot; blocker pulado → passa com aviso.
- **Nada é escrito até validar** — a plataforma herda essa regra do `generate-review.mjs`.
- **Commits só com o seu clique** — os fixes ficam unstaged no clone; "Criar branch e fazer push" é uma ação explícita (`revai/fix-<slug>`, via credential helper do sistema).

## 🔌 Runner (harness) — como é invocado

O review roda com o **runner padrão** definido no onboarding; na tela 03 ele aparece só como status ("executa este review"). A invocação é CLI headless com prompt via stdin:

| Harness | Invocação padrão (review) | Nota |
|---------|---------------------------|------|
| Kiro CLI | `kiro-cli exec` + stdin | o agente aplica em sandbox do clone |
| Claude Code | `claude -p --allowedTools "Write,Read,Glob,Grep" --disallowedTools Bash` + stdin | prompt via stdin |
| Codex | `codex exec --sandbox workspace-write` + stdin | |
| OpenCode | `opencode run` + stdin | |
| Copilot CLI | `copilot -p` + stdin | experimental |

Prompt grande **sempre vai via stdin** (evita limite de linha de comando no Windows). Para flags próprias, edite `customArgs` em `~/.revai/harnesses.json` (tokens: `{exe} {prompt} {model}`). Na revisão o agente só lê código e escreve em `.revai/` do clone descartável; no fix ele pode editar fontes (nunca tocar `.git/`).## 🔒 Privacidade

- Sem telemetria; nada sai da sua máquina.
- Diff/regras só circulam entre o clone sandbox, a skill e o seu harness local.
- O clone vivo é o `~/.revai/repos/<host>/<org>/<repo>` — **limpável a qualquer momento** em Ajustes.

## 🗂️ Estrutura

```
.                       (raiz do projeto)
├─ src/shared/        contrato: types.ts · gate.ts (espelho computeGate) · urls.ts (parser de origem)
├─ src/server/        hono + @hono/node-server
│  ├─ pipeline.ts     orquestração do review (SSE)
│  ├─ fixloop.ts      fila de fixes (apply → testes → gate delta)
│  ├─ git.ts          plumbing: clone, checkout, base, numstat, push, reset
│  ├─ skill.ts        ponte revai.mjs / generate-review.mjs
│  ├─ harnesses.ts    descoberta + validação + templates de invocação
│  └─ routes.ts · store.ts · paths.ts · proc.ts · picker.ts · errors.ts
└─ src/app/           react 19 + vite (styles.css = porta do prototype)
   ├─ screens/        Onboarding · NewReview · Configure · Running · Report · Fix · History · Settings · States
   └─ ui.tsx          badges, stepper, terminal, code-diff, toasts, gate panel
```

## 🧭 Roadmap

- [ ] Handshake **ACP** completo (checklist por-item com sessão read-only, como desenhado no protótipo)
- [ ] Redação de segredos antes do patch sair do clone (contrato `pipeline/safety.py` do legacy)
- [ ] Edição de templates de harness pela UI (08)
- [ ] Comparação de reviews (`GET /reviews/compare`) do legacy
- [ ] Multi-reviews agendadas + insights agregados

---

Feito em cima da narrativa do [`prototype/index.html`](./prototype/index.html) e dos contratos testados do `legacy/`. O design tokens continuam sendo "Hard Hat": zinc + amarelo `#facc15` usado **apenas** na ação primária, no foco e na marca.
