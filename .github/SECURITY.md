# Security Policy

## Supported versions

Only the [latest release](https://github.com/jonathasrochadesouza/revai-platform/releases/latest) receives security fixes.

## Reporting a vulnerability

- Please open a [GitHub issue](https://github.com/jonathasrochadesouza/revai-platform/issues) describing the problem. For sensitive reports that should not be public, email **jonathasrochadeveloper@gmail.com** with `[revai-platform security]` in the subject.
- You will get a response and, when applicable, a patch in the next release (every push to `main` is a release).

## Scope

Revai Platform is a **local-only** desktop app: it clones repositories into `~/.revai`, talks to no backend of its own and stores all data on your machine. Things worth reporting include, for example: the bundled local server binding or executing beyond expectations, unsafe handling of repository URLs, or path escapes from `~/.revai`. Vulnerabilities in the AI harness CLIs themselves (Claude Code, Codex, Kiro CLI, OpenCode, Copilot) belong to their respective projects.
