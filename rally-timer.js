import BasePlugin from "./base-plugin.js";

export default class RallyTimer extends BasePlugin {
  static get description() {
    return "Rally timer plugin";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      commands_to_start: {
        required: false,
        description: "list of commands",
        default: ["r", "rally", "raly"],
      },
      commands_to_stop: {
        required: false,
        description: "list of commands",
        default: ["sr", "stoprally", "stopraly", "stoprally"],
      },
      time_before_spawn: {
        required: false,
        description: "time before spawn at rally point",
        default: 20,
      },
      max_time: {
        required: false,
        description: "maximum timer time in minutes",
        default: 120,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.playerTimeouts = new Map();
    this.warn = this.warn.bind(this);
    this.startIntervalMessages = this.startIntervalMessages.bind(this);
    this.stopIntervalMessages = this.stopIntervalMessages.bind(this);
    this.clearAllTimeouts = this.clearAllTimeouts.bind(this);
    this.activateIntervalMessagesAboutRally = this.activateIntervalMessagesAboutRally.bind(this);
    this.sendMessageAboutRally = this.sendMessageAboutRally.bind(this);
  }

  async mount() {
    for (const command of this.options.commands_to_start) {
      this.server.on(`CHAT_COMMAND:${command}`, (data) => {
        this.startIntervalMessages(data);
      });
    }

    for (const command of this.options.commands_to_stop) {
      this.server.on(`CHAT_COMMAND:${command}`, (data) => {
        this.stopIntervalMessages(data);
      });
    }

    this.server.on("ROUND_ENDED", () => {
      this.clearAllTimeouts();
    });
  }

  startIntervalMessages(data) {
    if (data.player) {
      let isTimerSet = false;

      if (data.message) {
        const rallyTime = parseInt(data.message);
        if (rallyTime && rallyTime > 0 && rallyTime <= this.options.max_time) {
          // clear old timeout
          clearTimeout(this.playerTimeouts.get(data.player.steamID));

          const firstMessageDelay =
            rallyTime > this.options.time_before_spawn
              ? (rallyTime - this.options.time_before_spawn) * 1000
              : (60 - this.options.time_before_spawn + rallyTime) * 1000;

          this.activateIntervalMessagesAboutRally(firstMessageDelay, data.player);

          isTimerSet = true;
        }
      }

      if (!isTimerSet) {
        this.warn(
          data.player.steamID,
          `Write the rally time at the end of the command (from 0 to ${this.options.max_time})\For example, the rally timer shows 30 seconds, then: !rally 30`
        );
      }
    }
  }

  stopIntervalMessages(data) {
    if (data.player) {
      clearTimeout(this.playerTimeouts.get(data.player.steamID));
      this.warn(data.player.steamID, "Stopped sending rally reminders");
    }
  }

  clearAllTimeouts() {
    for (const timeout of this.playerTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.playerTimeouts.clear();
  }

  activateIntervalMessagesAboutRally(delay, player) {
    this.warn(
      player.steamID,
      `You will receive a reminder ${this.options.time_before_spawn} seconds before spawn at the rally\nYou can stop the reminder with the command\n!sr or !ср`
    );

    this.playerTimeouts.set(
      player.steamID,
      setTimeout(() => {
        this.sendMessageAboutRally(player.steamID);
        this.playerTimeouts.set(player.steamID, setInterval(this.sendMessageAboutRally, 60 * 1000, player.steamID));
      }, delay)
    );
  }

  async sendMessageAboutRally(steamID) {
    await this.warn(
      steamID,
      `Spawn at the rally in ${this.options.time_before_spawn} seconds\nYou can stop the reminder with the command\n!sr or !ср`
    );
  }
  
  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat is used so that squad displays all messages and does not hide them just because they are identical.
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }
}





