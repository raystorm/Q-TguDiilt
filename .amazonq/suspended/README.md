# Suspended Contexts

This directory stores suspended workflow contexts for later resumption.

## Purpose

Checkpoint workflow context at any level for later resumption, enabling multi-story/multi-phase work without context loss.

## Usage

- `@suspend [name]` - Save current context
- `@resume [name]` - Load saved context
- `@list` - Show all suspended contexts

## Files

- `INDEX.md` - Lists all suspended contexts (git ignored)
- `README.md` - This file (version controlled)
- `[context-name].md` - Individual suspended contexts (git ignored)

## Git Ignore

All files except README.md are git ignored to keep local workflow state out of version control.
