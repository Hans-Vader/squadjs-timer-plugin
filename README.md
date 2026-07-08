# SquadJS-Timer-Plugins
Forked from https://github.com/ar1ocker/SquadJS-Timer-Plugins

Plugins for SquadJS that allow you to set various timers with reminders.

# timer.js

A plugin that counts down a specified time and reminds you of the timer with a message you enter. Reminds with warms

For example, `!timer mbt 30` - the plugin will remind you about the MBT spawn in 30 minutes.

# rally-timer.js

A plugin that reminds you about the next rally wave shortly before it starts (so you have time to press give up). The reminder is **only sent while you are down** (wounded but not yet dead) — that is the only moment the info is useful. While you are alive it stays silent.

You enter the time your rally is currently showing, e.g. if there are 43 seconds until the wave: `!rally 43`.

> Note: Squad exposes no real rally/spawn timer to the server, so the countdown is an **estimate** modeled from the number you enter and a fixed cycle length (see `rally_interval_seconds`).

The rest of the details are in the script, it's simple, and the script installation is standard.

## Usage

For a timer: `!timer <message> <time in minutes>` (e.g., `!timer mbt 30`)

Everything else is one command, `!rally`:

| Command | What it does |
|---|---|
| `!rally 30` | Start a reminder (`30` = seconds your rally currently shows) |
| `!rally 30 25` | Start with a custom reminder lead time (warn `25`s before spawn) |
| `!rally 30 sq` (or `!rally 30 squad`) | Start a squad-wide rally: every squad member gets an invitation |
| `!rally yes` | Accept a pending squad rally invitation |
| `!rally optout` | Opt out (until server restart) of squad rally invitations |
| `!rally` | Show the estimated time until the next rally spawn |
| `!rally stop` | Stop your rally reminders |

The trigger word is configurable via the `commands` option (default `rally`, `r`, `rly`, `raly`), so `!r 30`, `!rly 30` etc. work too. The first entry is shown in the in-game help text.

Rally spawn cycle length is auto-detected: 60 seconds on vanilla layers, 45 seconds on SuperMod layers (raw layer id starts with `SU_`). Override it with the `rally_interval_seconds` option.

## Configuration

```jsonc
{
    "plugin": "RallyTimer",
    "enabled": true,
    "commands": {
        "required": false,
        "description": "Chat commands (without the ! prefix) that open the rally menu, e.g. !rally, !r. The first entry is used as the primary command in help/reminder text.",
        "default": ["rally", "r", "rly", "raly"]
    },
    "time_before_spawn": {
        "required": false,
        "description": "Default seconds before the modeled spawn at which the reminder fires (overridable per command, e.g. !rally 30 25)",
        "default": 20
    },
    "max_time": {
        "required": false,
        "description": "Maximum accepted rally-time argument, in seconds",
        "default": 120
    },
    "rally_interval_seconds": {
        "required": false,
        "description": "Rally spawn cycle length in seconds. Leave unset to auto-detect (60s vanilla, 45s on SuperMod layers prefixed with SU_).",
        "default": null
    }
},
{
    "plugin": "Timer",
    "enabled": true
}
```
