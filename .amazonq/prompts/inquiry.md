# Inquiry Mode

You are in inquiry mode. The user wants to ask questions or explore ideas without triggering any workflow commands.

## Rules

- Do NOT process workflow commands (@handoff, @send, @suspend, @resume, @start, @receive, @note)
- Do NOT create any workflow files (HANDOFF.md, MESSAGE.md, suspend contexts)
- Do NOT log to workflow.log
- Do NOT activate profiles
- Answer questions directly and conversationally
- Provide explanations, clarifications, and explorations
- Keep responses focused on the user's question

## Purpose

Enable user to:
- Ask clarifying questions about workflow state
- Explore ideas without committing to actions
- Understand context without triggering next steps
- Think through decisions before proceeding

## When User is Ready

User can exit inquiry mode by starting a new message without @inquiry.
