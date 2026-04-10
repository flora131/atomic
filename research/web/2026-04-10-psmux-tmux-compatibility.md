---
source_url: https://github.com/psmux/psmux
fetched_at: 2026-04-10
fetch_method: html-parse (raw GitHub content)
topic: psmux tmux config compatibility - -f flag, set-option syntax, specific options
---

# psmux tmux Compatibility Research

## Sources
- README: https://raw.githubusercontent.com/psmux/psmux/master/README.md
- Config docs: https://raw.githubusercontent.com/psmux/psmux/master/docs/configuration.md
- Compatibility docs: https://raw.githubusercontent.com/psmux/psmux/master/docs/compatibility.md
- FAQ: https://raw.githubusercontent.com/psmux/psmux/master/docs/faq.md

## -f Flag

From FAQ:
> "How do I use a custom config file? Use the -f flag: psmux -f /path/to/config.conf. This loads the specified file instead of the default search order."

From configuration docs:
```powershell
# Use a specific config file instead of default search
psmux -f ~/.config/psmux/custom.conf

# Use an empty config (no settings loaded)
psmux -f NUL
```
> "This sets the PSMUX_CONFIG_FILE environment variable internally, which the server checks before searching the default locations."

## Config Syntax

> "Config syntax is tmux-compatible. Most .tmux.conf lines work as-is."

Config file search order:
1. ~/.psmux.conf
2. ~/.psmuxrc
3. ~/.tmux.conf  ← reads tmux.conf directly
4. ~/.config/psmux/psmux.conf

## Supported Specific Options (from the All Set Options table)

| Option | Support | Notes |
|--------|---------|-------|
| `mouse on` | YES | Default is `on`, type Bool |
| `mode-keys vi` | YES | Supported values: `vi` or `emacs` |
| `set-clipboard` | YES | `on`/`off`/`external` |
| `allow-passthrough` | YES | `on`/`off`/`all` |
| `escape-time` | YES | Int, default 500ms |
| `history-limit` | YES | Int, default 2000 lines |
| `allow-rename` | YES | Bool, default `on` (so `allow-rename off` is valid) |
| `status-style` | YES | Full style string format supported |

## Known Incompatibilities

No explicit incompatibility list published. However:
- psmux adds Windows-specific extensions: `prediction-dimming`, `cursor-style`, `cursor-blink`, `env-shim`, `claude-code-fix-tty`, `claude-code-force-interactive`, `warm`, `allow-predictions`
- Default shell is `pwsh` (PowerShell 7) instead of bash
- psmux is Windows-only; not cross-platform

## Commands Count
- 76-92 tmux-compatible commands (README says 76, features.md says 92 — likely updated between docs)
- 126+ format variables
- 15+ event hooks

