// Catálogo de erros — mesma filosofia do legacy: {error_key, params} contratuais.
// A tela 10-states do protótipo demonstra cada um deles.
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public detail?: string,
    public status: number = 400,
  ) {
    super(message)
  }

  static from(e: unknown): AppError {
    return e instanceof AppError ? e : new AppError('internal/error', e instanceof Error ? e.message : String(e))
  }
}

export interface ErrorCatalogEntry {
  title: string
  message: string
  hint?: string
}

export const ERRORS: Record<string, ErrorCatalogEntry> = {
  'source/unrecognized': {
    title: 'Origem não reconhecida',
    message: 'Cole uma URL de repo (github.com/org/repo, gitlab, git@), org/repo, ou o caminho de uma pasta local.',
  },
  'repo/inaccessible': {
    title: 'Repositório inacessível',
    message: 'Não foi possível ler o repositório.',
    hint: 'Confira a URL — e se for privado, se as credenciais do sistema (credential helper do git) estão válidas.',
  },
  'repo/not-git': {
    title: 'A pasta não é um repositório git',
    message: 'O caminho informado não contém um repositório git.',
  },
  'repo/empty-diff': {
    title: 'Diff vazio',
    message: 'Não há mudanças entre a base e a head selecionadas.',
    hint: 'Escolha outra base ou outra branch/PR.',
  },
  'repo/head-not-found': {
    title: 'Branch/PR não encontrado',
    message: 'A branch, PR ou commit informado não existe no repositório.',
  },
  'harness/not-found': {
    title: 'Harness não encontrado',
    message: 'O CLI do harness não foi localizado no PATH.',
    hint: 'Instale o caminho manualmente em Harnesses.',
  },
  'harness/login-needed': {
    title: 'Login do harness necessário',
    message: 'O harness não está autenticado.',
    hint: 'Rode o login do CLI (ex.: codex login, claude login) e valide de novo.',
  },
  'harness/not-validated': {
    title: 'Harness não validado',
    message: 'Valide o harness em Harnesses antes de iniciar um review.',
  },
  'agent/failed': {
    title: 'O agente falhou',
    message: 'A execução do harness terminou com erro.',
  },
  'agent/timeout': {
    title: 'Tempo esgotado',
    message: 'A execução excedeu o limite de tempo configurado.',
  },
  'schema/validation': {
    title: 'Validação do schema falhou',
    message: 'Os dados do review estão fora do contrato V2 — nada é gerado até passar.',
  },
  'skill/not-found': {
    title: 'Skill revai não encontrada',
    message: 'Não foi possível localizar os scripts da skill revai.',
    hint: 'Defina REVAI_SKILL_DIR ou mantenha skill-version/ na raiz do projeto.',
  },
  'job/cancelled': {
    title: 'Review cancelado',
    message: 'A execução foi cancelada no meio do caminho.',
  },
  'fix/no-changes': {
    title: 'Nenhuma mudança aplicada',
    message: 'O agente não alterou nenhum arquivo para este fix.',
  },
  'test/failed': {
    title: 'Testes falharam',
    message: 'Os testes do projeto rodaram com erro.',
  },
  'push/failed': {
    title: 'Falha no push',
    message: 'Não foi possível fazer push da branch de fix.',
    hint: 'Confira as credenciais do sistema e permissões do remoto.',
  },
  'findings/already-resolved': {
    title: 'Finding já resolvido',
    message: 'Um finding resolvido não pode ser pulado.',
    hint: 'Restaurar desfaz um pulo; Corrigir resolve o finding de verdade.',
  },
}

export function errEntry(code: string): ErrorCatalogEntry {
  return ERRORS[code] ?? { title: code, message: code }
}
