# Secret Quarantine Report — 2026-05-06

Scope: `claude-code-eclaw-channel` repository safety pass for device/bot/Railway/DB credentials.

## Actions taken

- `TOOLS.md`: replaced embedded real `deviceId`, `deviceSecret`, and `botSecret` values/examples with placeholders.
- `.mcp.json`: moved out of the repository to local quarantine because it contained a real API key; added `.mcp.example.json` placeholder template.
- `reply-callback-check.sh`: moved out of the repository to local quarantine because it contained real device/bot credentials; added `reply-callback-check.example.sh` that reads credentials from environment variables.
- `ECLAW_API.md`: replaced a UUID-shaped example identifier with `EXAMPLE_MESSAGE_ID` to avoid secret-like samples.
- `.gitignore`: added local secret-bearing filenames so they do not re-enter git.

## Checked files

- `TOOLS.md`: real credential examples found and redacted.
- `README.md`: no high-confidence real device/bot/Railway/DB credential found.
- `ECLAW_API.md`: examples are placeholder-based after replacing one UUID-shaped sample identifier; no known real credential values found.
- `.mcp.json`: high-confidence local API key found and quarantined outside repo.
- `reply-callback-check.sh`: high-confidence device/bot credential found and quarantined outside repo.

No secret values are recorded in this report.
