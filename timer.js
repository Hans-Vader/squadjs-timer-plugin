import BasePlugin from "./base-plugin.js";

export default class Timer extends BasePlugin {
  static get description() {
    return "Time plugin";
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      max_time: {
        required: false,
        description: "maximum timer time in minutes",
        default: 30,
      },
      commands: {
        required: false,
        description: "list of commands",
        default: ["timer", "time", "timer", "set", "set timer", "settimer"],
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.warn = this.warn.bind(this);
  }

  async mount() {
    for (const index in this.options.commands) {
      this.server.on(`CHAT_COMMAND:${this.options.commands[index]}`, async (data) => {
        if (data.player) {
          let isTimerSet = false;

          if (data.message) {
            const time = parseInt(data.message.trim().split(" ").slice(-1)[0]);
            if (time && time > 0 && time <= this.options.max_time) {
              this.warn(data.player.steamID, `In ${time} minutes, we will remind you about: ${data.message}`);
              setTimeout(
                () => this.warn(data.player.steamID, `You asked to be reminded: ${data.message}`, 2),
                time * 60 * 1000
              );
              isTimerSet = true;
            }
          }

          if (!isTimerSet) {
            this.warn(
              data.player.steamID,
              `How many minutes should we set the timer for (from 0 to ${this.options.max_time})?\n\nWrite the time at the end of the command\nFor example: !timer mbt 30`
            );
          }
        }
      });
    }
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // 'repeat' is used so that the squad outputs all messages, not hiding them because they are identical
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }
}

