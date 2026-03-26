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
                description: "List of commands. 'rally' is always added to the list of commands to start the timer",
                default: ["r", "rly", "raly"],
            }, commands_to_stop: {
                required: false,
                description: "List of commands to start the rally timer (the first entry is used in the reminder message as a note!)",
                default: ["sr", "stop", "rs", "rts"],
            }, time_before_spawn: {
                required: false, description: "Default time before spawn at rally point", default: 20,
            }, commands_to_accept_squad: {
                required: false,
                description: "List of dedicated commands to accept a squad rally invitation",
                default: ["yes", "y", "yesrt", "rtyes", "accept"],
            }, max_time: {
                required: false, description: "Maximum timer time in minutes", default: 120
            },
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.playerTimer = new Map();
        this.rallyTimerPaused = new Map();
        this.optedOutPlayers = new Set();
        this.pendingSquadInvites = new Map();

        this.warn = this.warn.bind(this);
        this.startIntervalMessages = this.startIntervalMessages.bind(this);
        this.stopIntervalMessages = this.stopIntervalMessages.bind(this);
        this.clearAllTimeouts = this.clearAllTimeouts.bind(this);
        this.activateIntervalMessagesAboutRally = this.activateIntervalMessagesAboutRally.bind(this);
        this.sendMessageAboutRally = this.sendMessageAboutRally.bind(this);
        this.handleSquadRally = this.handleSquadRally.bind(this);
        this.handleAcceptInvite = this.handleAcceptInvite.bind(this);
        this.handleOptOut = this.handleOptOut.bind(this);
        this.onPlayerWounded = this.onPlayerWounded.bind(this);
        this.onPlayerAlive = this.onPlayerAlive.bind(this);
        this.onPlayerRevived = this.onPlayerRevived.bind(this);
        this.onPlayerDied = this.onPlayerDied.bind(this);
        this.onPlayerDamaged = this.onPlayerDamaged.bind(this);
    }

    async mount() {
        let commandsToStart = this.options.commands_to_start;
        commandsToStart.push('rally');
        for (const command of commandsToStart) {
            this.server.on(`CHAT_COMMAND:${command}`, (data) => {
                this.startIntervalMessages(data);
            });
        }

        for (const command of this.options.commands_to_stop) {
            this.server.on(`CHAT_COMMAND:${command}`, (data) => {
                this.stopIntervalMessages(data.player.steamID);
            });
        }

        for (const command of this.options.commands_to_accept_squad) {
            this.server.on(`CHAT_COMMAND:${command}`, (data) => {
                this.handleAcceptInvite(data.player);
            });
        }

        this.server.on("PLAYER_WOUNDED", (data) => this.onPlayerWounded(data));
        this.server.on("TEAMKILL", (data) => this.onPlayerWounded(data));
        this.server.on("PLAYER_DIED", (data) => this.onPlayerDied(data));
        this.server.on("PLAYER_REVIVED", (data) => this.onPlayerRevived(data));
        this.server.on("PLAYER_DAMAGED", (data) => this.onPlayerDamaged(data));

        this.server.on("ROUND_ENDED", () => {
            this.clearAllTimeouts();
        });
    }

    async startIntervalMessages(data) {
        if (data.player) {
            const message = data.message.toLowerCase();

            // split by spaces and remove empty entries
            const commandSplit = message.trim().split(/\s+/).filter(Boolean);

            // Handle squad invite accept
            if (commandSplit[0] === "yes") {
                this.handleAcceptInvite(data.player);
                return;
            }

            // Handle squad invite opt-out
            if (commandSplit[0] === "optout") {
                this.handleOptOut(data.player);
                return;
            }

            // Set new timer
            let isTimerSet = false;
            if (commandSplit.length > 0) {
                const rallyTime = parseInt(commandSplit[0]);
                if (rallyTime && rallyTime > 0 && rallyTime <= this.options.max_time) {

                    // Check if second param is squad mode
                    const secondParam = commandSplit[1];
                    if (secondParam && (secondParam === "sq" || secondParam === "squad")) {
                        this.handleSquadRally(data.player, rallyTime);
                        return;
                    }

                    // clear old timeout
                    clearTimeout(this.playerTimer.get(data.player.steamID));
                    this.rallyTimerPaused.delete(data.player.steamID);

                    let timeBeforeSpawn = this.options.time_before_spawn;
                    const customTimeBeforeSpawn = parseInt(secondParam);
                    if (customTimeBeforeSpawn && customTimeBeforeSpawn > 0) {
                        timeBeforeSpawn = customTimeBeforeSpawn;
                    }

                    const firstMessageDelay = rallyTime > timeBeforeSpawn ? (rallyTime - timeBeforeSpawn) * 1000 : (60 - timeBeforeSpawn + rallyTime) * 1000;

                    this.activateIntervalMessagesAboutRally(firstMessageDelay, data.player, timeBeforeSpawn);

                    isTimerSet = true;
                }
            }

            // Accept pending squad invite if command used without arguments
            if (!isTimerSet && this.pendingSquadInvites.has(data.player.steamID)) {
                this.handleAcceptInvite(data.player);
                return;
            }

            if (!isTimerSet) {
                this.warn(data.player.steamID, `Enter the CURRENT rally time (from 0 to ${this.options.max_time})\n\nFor example:\nTimer shows 30 seconds, then: !rally 30\nSquad rally: !rally 30 sq`);
                await new Promise((resolve) => setTimeout(resolve, 6 * 1000));
                this.warn(data.player.steamID, `Custom reminder time. For example:\n!rally 30 25\nThis will set a reminder 25 seconds before spawn.\nWarnings appear automatically when you're wounded.`);
            }
        }
    }

    stopIntervalMessages(steamID) {
        if (steamID) {
            clearTimeout(this.playerTimer.get(steamID));
            this.playerTimer.delete(steamID);
            this.rallyTimerPaused.delete(steamID);
            this.warn(steamID, "Stopped sending rally reminders");
        }
    }

    onPlayerWounded(data) {
        const steamID = data.victim?.steamID;
        if (!steamID || !this.playerTimer.has(steamID)) return;
        if (!this.rallyTimerPaused.has(steamID)) return; // already wounded/unpaused

        const pauseData = this.rallyTimerPaused.get(steamID);
        this.rallyTimerPaused.delete(steamID);

        if (pauseData.lastTickAt) {
            const timeSinceLastTick = (Date.now() - pauseData.lastTickAt) / 1000;
            let timeUntilSpawn = Math.round(pauseData.timeBeforeSpawn - timeSinceLastTick);
            if (timeUntilSpawn < 0) timeUntilSpawn += 60;
            this.warn(steamID, `Rally spawn in ~${timeUntilSpawn} seconds!`);
        }
    }

    onPlayerAlive(steamID) {
        if (!steamID || !this.playerTimer.has(steamID)) return;
        if (this.rallyTimerPaused.has(steamID)) return; // already alive/paused

        this.rallyTimerPaused.set(steamID, {});
    }

    onPlayerRevived(data) {
        this.onPlayerAlive(data.victim?.steamID);
        this.onPlayerAlive(data.reviver?.steamID);
    }

    onPlayerDied(data) {
        this.onPlayerAlive(data.victim?.steamID);
    }

    onPlayerDamaged(data) {
        if (data.attackerSteamID) {
            this.onPlayerAlive(data.attackerSteamID);
        }
        const victim = this.server.players.find(p => p.name === data.victimName);
        if (victim) {
            this.onPlayerAlive(victim.steamID);
        }
    }

    clearAllTimeouts() {
        for (const timeout of this.playerTimer.values()) {
            clearTimeout(timeout);
        }
        this.playerTimer.clear();
        this.rallyTimerPaused.clear();
        this.pendingSquadInvites.clear();
    }

    handleSquadRally(initiator, rallyTime) {
        if (!initiator.squadID) {
            this.warn(initiator.steamID, "You must be in a squad to use squad rally mode.");
            return;
        }

        // Start timer for the initiator
        clearTimeout(this.playerTimer.get(initiator.steamID));
        this.rallyTimerPaused.delete(initiator.steamID);

        const timeBeforeSpawn = this.options.time_before_spawn;
        const firstMessageDelay = rallyTime > timeBeforeSpawn ? (rallyTime - timeBeforeSpawn) * 1000 : (60 - timeBeforeSpawn + rallyTime) * 1000;

        this.activateIntervalMessagesAboutRally(firstMessageDelay, initiator, timeBeforeSpawn);

        // Anchor for syncing squad members to the same 60s reminder cycle
        const cycleAnchor = Date.now() + firstMessageDelay;

        // Find squad members (excluding initiator)
        const squadMembers = this.server.players.filter(
            p => p.squadID === initiator.squadID && p.teamID === initiator.teamID && p.steamID !== initiator.steamID
        );

        let invitedCount = 0;
        const commandAcceptPrefix = '!' + this.options.commands_to_accept_squad[0];
        const commandStartPrefix = '!' + this.options.commands_to_start[0];

        for (const member of squadMembers) {
            if (this.optedOutPlayers.has(member.steamID)) {
                continue;
            }

            this.pendingSquadInvites.set(member.steamID, {
                timeBeforeSpawn,
                initiatorName: initiator.name,
                cycleAnchor,
            });

            this.warn(member.steamID,
                `${initiator.name} started a squad rally timer!` +
                `\nAccept: ${commandStartPrefix} yes or ${commandAcceptPrefix}` +
                `\nOpt out (no invites): ${commandStartPrefix} optout`
            );
            invitedCount++;
        }

        this.warn(initiator.steamID, `Squad rally started! Invitations sent to ${invitedCount} squad member(s).`);
    }

    handleAcceptInvite(player) {
        if (!player) return;

        const invite = this.pendingSquadInvites.get(player.steamID);
        if (!invite) {
            this.warn(player.steamID, "You don't have a pending squad rally invitation.");
            return;
        }

        this.pendingSquadInvites.delete(player.steamID);

        // Clear any existing timer
        clearTimeout(this.playerTimer.get(player.steamID));
        this.rallyTimerPaused.delete(player.steamID);

        // Sync to the initiator's 60s reminder cycle
        const now = Date.now();
        const elapsed = now - invite.cycleAnchor;
        const cycleMs = 60 * 1000;
        let syncedDelay;

        if (elapsed < 0) {
            // First reminder hasn't fired yet
            syncedDelay = -elapsed;
        } else {
            // Align to the next tick in the 60s cycle
            syncedDelay = cycleMs - (elapsed % cycleMs);
        }

        this.activateIntervalMessagesAboutRally(syncedDelay, player, invite.timeBeforeSpawn);
    }

    handleOptOut(player) {
        if (!player) return;

        this.optedOutPlayers.add(player.steamID);
        this.pendingSquadInvites.delete(player.steamID);
        this.warn(player.steamID, "You have opted out of squad rally invitations.");
    }

    activateIntervalMessagesAboutRally(delay, player, timeBeforeSpawn) {
        let commandStopPrefix = this.getCommandStopPrefixString();

        this.warn(
            player.steamID,
            `Rally reminder active (${timeBeforeSpawn}s before spawn).` +
            `\nWarnings appear when you're wounded.` +
            `\nSTOP with: ${commandStopPrefix}`
        );

        // Start in alive/suppressed state — messages only sent when wounded
        this.rallyTimerPaused.set(player.steamID, {});

        this.playerTimer.set(player.steamID, setTimeout(() => {
            this.sendMessageAboutRally(player.steamID, timeBeforeSpawn);

            const intervalId = setInterval(() => this.sendMessageAboutRally(player.steamID, timeBeforeSpawn), 60 * 1000);

            this.playerTimer.set(player.steamID, intervalId);
        }, delay));
    }

    async sendMessageAboutRally(steamID, timeBeforeSpawn) {
        // Do not send message if alive (paused), but track timing so wound event can show time until spawn
        const pauseData = this.rallyTimerPaused.get(steamID);
        if (pauseData) {
            pauseData.timeBeforeSpawn = timeBeforeSpawn;
            pauseData.lastTickAt = Date.now();
            return;
        }

        await this.warn(
            steamID,
            `Rally spawn in ${timeBeforeSpawn} seconds! (!` + this.options.commands_to_stop[0] + ` to stop)`
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

    getCommandStopPrefixString() {
        return '!' + this.options.commands_to_stop.join(', !');
    }

}
