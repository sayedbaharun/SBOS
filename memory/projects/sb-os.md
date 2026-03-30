# SB-OS — Personal Operating System

**Domain:** SaaS / Personal
**Status:** Active (Phase 11 — Testing with real data)
**Repo:** sayedbaharun/SBOS
**Live:** https://sbaura.up.railway.app
**Hosting:** Railway (auto-deploy from main)

## What It Is

Full-stack personal operating system replacing Notion, Todoist, and other fragmented tools. Built for one user (Sayed Baharun) to manage multiple ventures, tasks, health, trading, and knowledge from a single system.

## Tech Stack

- Frontend: React 18, Tailwind, shadcn/ui, Wouter, TanStack Query
- Backend: Express.js, Node.js, TypeScript
- Database: PostgreSQL (Railway-managed), Drizzle ORM
- AI: OpenRouter (multi-model), Cerebras (compaction)
- Vector: Qdrant (primary), Pinecone (backup), FalkorDB (graph)
- Bot: Telegram (@SBNexusBot), WhatsApp Cloud API

## Key Numbers

- 71 database tables
- 180+ API endpoints
- 35 frontend pages
- 174 UI components
- 21 AI agents (hierarchical)
- 30+ scheduled jobs
- 12 Telegram commands

## Current State (2026-03-30)

- Phase 11: DB wiped, testing with real data from scratch
- Documentation reorganized (docs/ folder restructured)
- CLAUDE.md updated with Agent OS, Memory, Compaction sections
- Setting up shared memory system between Claude Code ↔ Cowork
