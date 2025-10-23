import BasePlugin from "./base-plugin.js";

export default class Timer extends BasePlugin {
  static get description() {
    return "Time plugin";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      max_time: {
        required: false,
        description: "max time at timer in minutes",
        default: 30,
      },
      commands: {
        required: false,
        description: "list of commands",
        default: ["таймер", "тайм", "time", "timer", "засечь"],
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
              this.warn(data.player.steamID, `Через ${time} минут мы напомним тебе о: ${data.message}`);
              setTimeout(
                () => this.warn(data.player.steamID, `Ты просил напомнить: ${data.message}`, 2),
                time * 60 * 1000
              );
              isTimerSet = true;
            }
          }

          if (!isTimerSet) {
            this.warn(
              data.player.steamID,
              `На сколько минут нужно поставить таймер (от 0 до ${this.options.max_time})? Напиши время в конце команды\nНапример: !таймер танк 30`
            );
          }
        }
      });
    }
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }
}
