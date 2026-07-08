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
            commands: {
                required: false,
                description: "Chat commands (without the ! prefix) that open the rally menu, e.g. !rally, !r. The first entry is used as the primary command in help/reminder text.",
                default: ["rally", "r", "rly"],
            }, time_before_spawn: {
                required: false,
                description: "Default seconds before the modeled spawn at which the reminder fires (overridable per command, e.g. !rally 30 25).",
                default: 20,
            }, max_time: {
                required: false,
                description: "Maximum accepted rally-time argument, in seconds.",
                default: 120,
            }, rally_interval_seconds: {
                required: false,
                description: "Rally spawn cycle length in seconds. Leave unset to auto-detect (60s vanilla, 45s on SuperMod layers prefixed with SU_).",
                default: null,
            },
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.playerTimer = new Map();          // steamID -> timeout/interval id
        this.downedPlayers = new Set();        // steamIDs currently wounded-but-not-dead
        this.optedOutPlayers = new Set();      // steamIDs opted out of squad invites
        this.pendingSquadInvites = new Map();  // steamID -> { timeBeforeSpawn, initiatorName, cycleAnchor }
        this.nextSpawnAt = new Map();          // steamID -> timestamp of next modeled spawn

        // Primary command word, used in all help/reminder text.
        this.command = this.options.commands?.[0] || "rally";

        // Only listener-registered handlers need binding (so unmount can remove them by reference).
        this.onRallyCommand = this.onRallyCommand.bind(this);
        this.onPlayerWounded = this.onPlayerWounded.bind(this);
        this.onPlayerDied = this.onPlayerDied.bind(this);
        this.onPlayerRevived = this.onPlayerRevived.bind(this);
        this.reconcileDownedPlayers = this.reconcileDownedPlayers.bind(this);
        this.clearAllTimeouts = this.clearAllTimeouts.bind(this);
        this.warn = this.warn.bind(this);
    }

    async mount() {
        for (const command of this.options.commands) {
            this.server.on(`CHAT_COMMAND:${command}`, this.onRallyCommand);
        }
        this.server.on("PLAYER_WOUNDED", this.onPlayerWounded);
        this.server.on("TEAMKILL", this.onPlayerWounded);
        this.server.on("PLAYER_DIED", this.onPlayerDied);
        this.server.on("PLAYER_REVIVED", this.onPlayerRevived);
        this.server.on("UPDATED_PLAYER_INFORMATION", this.reconcileDownedPlayers);
        this.server.on("ROUND_ENDED", this.clearAllTimeouts);
    }

    async unmount() {
        for (const command of this.options.commands) {
            this.server.removeListener(`CHAT_COMMAND:${command}`, this.onRallyCommand);
        }
        this.server.removeListener("PLAYER_WOUNDED", this.onPlayerWounded);
        this.server.removeListener("TEAMKILL", this.onPlayerWounded);
        this.server.removeListener("PLAYER_DIED", this.onPlayerDied);
        this.server.removeListener("PLAYER_REVIVED", this.onPlayerRevived);
        this.server.removeListener("UPDATED_PLAYER_INFORMATION", this.reconcileDownedPlayers);
        this.server.removeListener("ROUND_ENDED", this.clearAllTimeouts);
        this.clearAllTimeouts();
    }

    // Single entry point for every !rally variant.
    async onRallyCommand(data) {
        const player = data.player;
        if (!player) return;

        const tokens = data.message.toLowerCase().trim().split(/\s+/).filter(Boolean);

        // Bare "!rally" -> time until next spawn (doubles as help when no timer is set).
        if (tokens.length === 0) {
            this.handleCheckTime(player);
            return;
        }

        const first = tokens[0];
        if (first === "stop") {
            this.stopIntervalMessages(player.steamID);
            return;
        }
        if (first === "yes") {
            this.handleAcceptInvite(player);
            return;
        }
        if (first === "optout") {
            this.handleOptOut(player);
            return;
        }

        const rallyTime = parseInt(first, 10);
        if (rallyTime > 0 && rallyTime <= this.options.max_time) {
            const second = tokens[1];

            if (second === "sq" || second === "squad") {
                this.handleSquadRally(player, rallyTime);
                return;
            }

            let timeBeforeSpawn = this.options.time_before_spawn;
            const customLead = parseInt(second, 10);
            if (customLead > 0) {
                timeBeforeSpawn = customLead;
            }

            this.startTimer(player, rallyTime, timeBeforeSpawn);
            return;
        }

        const c = this.command;
        this.warn(player.steamID,
            `Enter the CURRENT rally time in seconds.` +
            `\n!${c} 30        start (timer shows 30s)` +
            `\n!${c} 30 25     start, warn 25s before spawn` +
            `\n!${c} 30 sq     squad rally (invite your squad)` +
            `\n!${c}           time until next spawn` +
            `\n!${c} stop      stop reminders`
        );
    }

    // Arm a per-player reminder; returns the delay until the first reminder (used to sync squads).
    startTimer(player, rallyTime, timeBeforeSpawn) {
        clearTimeout(this.playerTimer.get(player.steamID));

        const cycleSeconds = this.getRallyIntervalSeconds();
        const firstMessageDelay = rallyTime > timeBeforeSpawn
            ? (rallyTime - timeBeforeSpawn) * 1000
            : (cycleSeconds - timeBeforeSpawn + rallyTime) * 1000;

        this.activateIntervalMessagesAboutRally(firstMessageDelay, player, timeBeforeSpawn);
        return firstMessageDelay;
    }

    stopIntervalMessages(steamID) {
        if (!steamID) return;
        clearTimeout(this.playerTimer.get(steamID));
        this.playerTimer.delete(steamID);
        this.nextSpawnAt.delete(steamID);
        this.warn(steamID, "Stopped sending rally reminders");
    }

    onPlayerWounded(data) {
        const steamID = data.victim?.steamID;
        if (!steamID) return;
        this.downedPlayers.add(steamID);

        // If they have a running reminder, show the countdown the instant they go down.
        if (this.playerTimer.has(steamID) && this.nextSpawnAt.has(steamID)) {
            this.warn(steamID, `Rally spawn in ~${this.secondsUntilSpawn(steamID)} seconds!`);
        }
    }

    onPlayerDied(data) {
        const steamID = data.victim?.steamID;
        if (steamID) this.downedPlayers.delete(steamID);
    }

    onPlayerRevived(data) {
        const steamID = data.victim?.steamID;
        if (steamID) this.downedPlayers.delete(steamID);
    }

    // PLAYER_DISCONNECTED effectively never fires, so drop down-state for players who left.
    reconcileDownedPlayers() {
        if (this.downedPlayers.size === 0) return;
        const present = new Set(this.server.players.map(p => p.steamID));
        for (const steamID of this.downedPlayers) {
            if (!present.has(steamID)) this.downedPlayers.delete(steamID);
        }
    }

    clearAllTimeouts() {
        for (const timeout of this.playerTimer.values()) {
            clearTimeout(timeout);
        }
        this.playerTimer.clear();
        this.downedPlayers.clear();
        this.pendingSquadInvites.clear();
        this.nextSpawnAt.clear();
    }

    handleSquadRally(initiator, rallyTime) {
        if (!initiator.squadID) {
            this.warn(initiator.steamID, "You must be in a squad to use squad rally mode.");
            return;
        }

        const timeBeforeSpawn = this.options.time_before_spawn;
        const firstMessageDelay = this.startTimer(initiator, rallyTime, timeBeforeSpawn);

        // Anchor for syncing squad members to the same reminder cycle.
        const cycleAnchor = Date.now() + firstMessageDelay;

        // Same squad + same team, excluding the initiator.
        const squadMembers = this.server.players.filter(
            p => p.squadID === initiator.squadID && p.teamID === initiator.teamID && p.steamID !== initiator.steamID
        );

        let invitedCount = 0;
        for (const member of squadMembers) {
            if (this.optedOutPlayers.has(member.steamID)) continue;

            this.pendingSquadInvites.set(member.steamID, {
                timeBeforeSpawn,
                initiatorName: initiator.name,
                cycleAnchor,
            });

            this.warn(member.steamID,
                `${initiator.name} started a squad rally timer!` +
                `\nAccept: !${this.command} yes` +
                `\nOpt out (no invites): !${this.command} optout`
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

        clearTimeout(this.playerTimer.get(player.steamID));

        // Sync to the initiator's reminder cycle.
        const elapsed = Date.now() - invite.cycleAnchor;
        const cycleMs = this.getRallyIntervalSeconds() * 1000;
        const syncedDelay = elapsed < 0 ? -elapsed : cycleMs - (elapsed % cycleMs);

        this.activateIntervalMessagesAboutRally(syncedDelay, player, invite.timeBeforeSpawn);
    }

    handleOptOut(player) {
        if (!player) return;

        this.optedOutPlayers.add(player.steamID);
        this.pendingSquadInvites.delete(player.steamID);
        this.warn(player.steamID, "You have opted out of squad rally invitations.");
    }

    activateIntervalMessagesAboutRally(delay, player, timeBeforeSpawn) {
        this.warn(
            player.steamID,
            `Rally reminder active (${timeBeforeSpawn}s before spawn).` +
            `\nWarnings appear when you're wounded.` +
            `\nStop with: !${this.command} stop`
        );

        this.nextSpawnAt.set(player.steamID, Date.now() + delay + timeBeforeSpawn * 1000);

        this.playerTimer.set(player.steamID, setTimeout(() => {
            this.sendMessageAboutRally(player.steamID, timeBeforeSpawn);

            const intervalId = setInterval(
                () => this.sendMessageAboutRally(player.steamID, timeBeforeSpawn),
                this.getRallyIntervalSeconds() * 1000
            );

            this.playerTimer.set(player.steamID, intervalId);
        }, delay));
    }

    async sendMessageAboutRally(steamID, timeBeforeSpawn) {
        // Refresh the modeled spawn time every tick so !rally stays accurate,
        // regardless of whether we actually warn this tick.
        this.nextSpawnAt.set(steamID, Date.now() + timeBeforeSpawn * 1000);

        // Only warn players who are currently down AND still on the server.
        if (!this.downedPlayers.has(steamID)) return;
        if (!this.server.players.some(p => p.steamID === steamID)) return;

        await this.warn(steamID, `Rally spawn in ${timeBeforeSpawn} seconds! (!${this.command} stop to stop)`);
    }

    async warn(playerID, message, repeat = 1, frequency = 5) {
        for (let i = 0; i < repeat; i++) {
            // repeat is used so the client shows all messages instead of hiding identical ones.
            await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

            if (i !== repeat - 1) {
                await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
            }
        }
    }

    handleCheckTime(player) {
        if (!player) return;

        const steamID = player.steamID;
        if (!this.playerTimer.has(steamID) || !this.nextSpawnAt.has(steamID)) {
            this.warn(steamID, `You don't have an active rally timer. Start one with: !${this.command} <seconds>`);
            return;
        }

        this.warn(steamID, `Next rally spawn in ~${this.secondsUntilSpawn(steamID)} seconds.`);
    }

    // Estimated seconds until the next modeled spawn; advances by whole cycles if just passed.
    secondsUntilSpawn(steamID) {
        let secondsLeft = Math.round((this.nextSpawnAt.get(steamID) - Date.now()) / 1000);
        const cycleSeconds = this.getRallyIntervalSeconds();
        while (secondsLeft <= 0) {
            secondsLeft += cycleSeconds;
        }
        return secondsLeft;
    }

    getRallyIntervalSeconds() {
        const configured = this.options.rally_interval_seconds;
        if (typeof configured === "number" && configured > 0) {
            return configured;
        }

        const layer = this.server?.currentLayer;
        if (layer) {
            const candidates = [layer.layerid, layer.classname, layer.name];
            for (const candidate of candidates) {
                if (typeof candidate === "string" && candidate.length > 0) {
                    return candidate.startsWith("SU_") ? 45 : 60;
                }
            }
        }

        return 60;
    }

}
