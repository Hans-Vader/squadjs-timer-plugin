# SquadJS-Timer-Plugins
Forked from https://github.com/ar1ocker/SquadJS-Timer-Plugins

Plugins for SquadJS that allow you to set various timers with reminders.

# timer.js

A plugin that counts down a specified time and reminds you of the timer with a message you enter. Reminds with warms

For example, `!timer mbt 30` - the plugin will remind you about the MBT spawn in 30 minutes.

# rally-timer.js

A plugin that will remind you about a new wave in the rally 20 seconds before it starts (so you have time to press give up).

You need to enter the time that your rally is currently showing, for example, if there are 43 seconds until the wave, you need to enter `!rally 43`.

The rest of the details are in the script, it's simple, and the script installation is standard.

## Usage

- For a timer: `!timer <message> <time in minutes>` (e.g., `!timer mbt 30`)
- For a rally reminder: `!rally <current rally time in seconds>` (e.g., `!rally 43` with default reminder time)
- For a rally reminder with a custom remind time: `!rally <current rally time in seconds> <time in seconds>` (e.g., `!rally 43 25`)
- You can pause / resume the rally reminder in various ways, for example:
    - `!pr` 
    - `!pause`
    - `!rally`
    - `!rally pause`

## Configuration

```jsonc
{
    "plugin": "RallyTimer",
    "enabled": true,
    "commands_to_start": {
        "required": false,
        "description": "List of commands. 'rally' is always added to the list of commands to start the timer",
        "default": ["r", "rly", "raly"]
    },
    "commands_to_stop": {
        "required": false,
        "description": "List of commands to start the rally timer (the first entry is used in the reminder message as a note!)",
        "default": ["sr", "stop", "rs", "rts"]
    },
    "commands_to_pause": {
        "required": false,
        "description": "List of commands to pause the rally timer (the first entry is used in the reminder message as a note!)",
        "default": ["pr", "pause", "rp", "rtp"]
    },
    "time_before_spawn": {
        "required": false,
        "description": "Default time before spawn at rally point",
        "default": 20
    },
    "max_time": {
        "required": false,
        "description": "Maximum timer time in minutes",
        "default": 120
    }
},
{
    "plugin": "Timer",
    "enabled": true
}
```
