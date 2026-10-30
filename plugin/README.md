# Lumen plugin for Claude Code

Five hooks (UserPromptSubmit, PreToolUse, Stop, Notification, SessionEnd) that pass each event to Lumen while it runs
and bring back what you send to the agent from its window. When Lumen is not running they end at once.

Lumen does not install it. From the repository root, link this folder into your personal skills directory, and Claude
Code loads it as `lumen@skills-dir` in every new session:

```bash
ln -s "$PWD/plugin" ~/.claude/skills/lumen
```

Check it with `claude plugin list`. Turn it off with `claude plugin disable lumen@skills-dir`, or remove the link.
