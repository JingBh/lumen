# Lumen plugins

One plugin per app. Each passes a few hook events to Lumen while it runs and brings back what you send to the agent
from its window; when Lumen is not running they end at once. Lumen reads the rest from the app's own history. It does
not install them.

## Claude Code

Five hooks (UserPromptSubmit, PreToolUse, Stop, Notification, SessionEnd). From the repository root, link the folder into
your personal skills directory, and Claude Code loads it as `lumen@skills-dir` in every new session:

```bash
ln -s "$PWD/plugins/claude-code" ~/.claude/skills/lumen
```

Check it with `claude plugin list`. Turn it off with `claude plugin disable lumen@skills-dir`, or remove the link.

## Codex

Six hooks (UserPromptSubmit, PreToolUse, PermissionRequest, Stop, Interrupt, SessionEnd), which need the `hooks` feature.
From the repository root, add this folder as a marketplace and install the plugin from it:

```bash
codex plugin marketplace add "$PWD/plugins"
```

```bash
codex plugin add lumen@lumen
```

Codex runs a plugin's hooks only once you have trusted them: review them with `/hooks` in Codex.

## ZCode

Four hooks (UserPromptSubmit, PreToolUse, PermissionRequest, Stop). In ZCode, open 插件市场 → 添加 → 添加插件市场 and
paste the full path of this folder, then install Lumen from 个人 → lumen.

Both Codex and ZCode install a copy. After the plugin changes, refresh the marketplace and update the plugin.
