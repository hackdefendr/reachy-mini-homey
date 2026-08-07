'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const weatherLib = require('./lib/weather');

// Never control our own robot device from voice commands.
const SELF_URI = 'co.hf.reachy';

module.exports = class ReachyApp extends Homey.App {

  async onInit() {
    this.commandTrigger = this.homey.flow.getTriggerCard('command_received');
    this.commandTrigger.registerRunListener((args, state) => {
      const command = String(state.command || '').toLowerCase();
      const match = String(args.match || '').toLowerCase().trim();
      return match === '' || command.includes(match);
    });

    this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.log('Reachy app initialized');
  }

  /**
   * Handle a voice command relayed from the robot's conversation tool.
   * @param {{command?: string}} body
   * @returns {Promise<{status: string, command: string, message: string}>}
   */
  async onVoiceCommand(body) {
    const command = String(body.command || '').trim();
    if (!command) throw new Error('No command provided');
    this.log('Voice command received:', command);

    this.commandTrigger.trigger({ command }, { command })
      .catch((err) => this.error('command trigger failed:', err.message));

    let message;
    try {
      message = await this.controlDevices(command);
    } catch (err) {
      this.error('controlDevices failed:', err.message);
      message = `I couldn't complete that in Homey: ${err.message}`;
    }
    this.log('->', message);
    return { status: 'ok', command, message };
  }

  /**
   * Current local time and weather, as structured data plus a ready-to-speak
   * sentence. Used by the conversation AI's get_time_and_weather tool so Reachy
   * can actually answer "what's the weather?" and announce it.
   * @returns {Promise<{time: string, weather: object|null, message: string}>}
   */
  async getTimeWeather() {
    // Prefer the Reachy device's own units/clock settings.
    let units = 'fahrenheit';
    let clock = '12';
    try {
      const [device] = this.homey.drivers.getDriver('reachy-mini').getDevices();
      if (device) {
        units = device.getSetting('units') || units;
        clock = device.getSetting('clock') || clock;
      }
    } catch (_err) { /* no device yet — use defaults */ }

    const timeStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: clock === '12',
      timeZone: this.homey.clock.getTimezone(),
    }).format(new Date());

    let weather = null;
    let weatherStr = '';
    try {
      const lat = this.homey.geolocation.getLatitude();
      const lon = this.homey.geolocation.getLongitude();
      if (lat != null && lon != null) {
        weather = await weatherLib.getCurrent(lat, lon, { unit: units });
        weatherStr = ` It's ${weather.temperature} degrees and ${weather.description}.`;
      }
    } catch (err) {
      this.error('weather lookup failed:', err.message);
    }

    return { time: timeStr, weather, message: `It's ${timeStr}.${weatherStr}` };
  }

  /**
   * URLs the robot's conversation tools should call, for the voice-control
   * setup helper on the app settings page. Uses the Homey's cloud address,
   * which is reachable with a valid TLS cert and doesn't depend on the local IP.
   * @returns {Promise<{commandUrl: string, infoUrl: string, cloudId: string}>}
   */
  async getSetupInfo() {
    let cloudId = '';
    try {
      cloudId = await this.homey.cloud.getHomeyId();
    } catch (err) {
      this.error('getHomeyId failed:', err.message);
    }
    const base = cloudId ? `https://${cloudId}.connect.athom.com/api/app/co.hf.reachy` : '';
    return {
      cloudId,
      appUrl: base,
      commandUrl: base ? `${base}/command` : '',
      infoUrl: base ? `${base}/info` : '',
      memoryUrl: base ? `${base}/memory` : '',
    };
  }

  // ---- Short-term conversation memory --------------------------------------
  // A small, durable notepad the robot reads/writes through the same tool ->
  // endpoint bridge as everything else. It lives in Homey settings, which
  // survive reboots and app/robot upgrades (the robot side does not). The
  // robot's LLM decides WHAT is worth remembering; Homey only stores it and
  // keeps the footprint small (count cap, byte budget, day age-out).
  static get _MEM() {
    return { KEY: 'memory', FACT_CAP: 24, FACT_CHARS: 240, DIGEST_CHARS: 700, BUDGET: 6000, KEEP_DAYS: 2 };
  }

  _loadMemory() {
    const m = this.homey.settings.get(ReachyApp._MEM.KEY);
    return (m && typeof m === 'object')
      ? { v: 1, facts: [], digest: '', updatedAt: 0, ...m }
      : { v: 1, facts: [], digest: '', updatedAt: 0 };
  }

  /** Local "YYYY-MM-DD" in the home's timezone, for day-based age-out. */
  _dayKey(ts = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.homey.clock.getTimezone() }).format(new Date(ts));
  }

  /**
   * Recall memory as structured data plus a ready-to-inject preamble the
   * conversation app prepends to its system prompt. Compaction runs (and is
   * persisted) even on a read, so stale entries trim after a reboot.
   * @returns {Promise<{digest: string, facts: object[], preamble: string}>}
   */
  async recallMemory() {
    const mem = this._compact(this._loadMemory());
    this.homey.settings.set(ReachyApp._MEM.KEY, mem);
    const today = this._dayKey();
    const lines = mem.facts.map((f) => `- (${f.day === today ? 'today' : f.day}) ${f.text}`);
    const preamble = [
      mem.digest ? `What you remember about the user so far: ${mem.digest}` : '',
      lines.length ? `Recent notes:\n${lines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    return { digest: mem.digest, facts: mem.facts, preamble };
  }

  /**
   * Store a fact, or (body.kind === 'digest') replace the running long-term
   * digest wholesale — the deliberate end-of-session overwrite that keeps the
   * footprint small.
   * @param {{text?: string, kind?: string}} body
   */
  async rememberMemory(body) {
    const text = String(body.text || '').trim();
    if (!text) throw new Error('Nothing to remember');
    const mem = this._loadMemory();
    if (body.kind === 'digest') {
      mem.digest = text.slice(0, ReachyApp._MEM.DIGEST_CHARS);
    } else {
      mem.facts.push({ t: Date.now(), day: this._dayKey(), text: text.slice(0, ReachyApp._MEM.FACT_CHARS) });
    }
    mem.updatedAt = Date.now();
    const saved = this._compact(mem);
    this.homey.settings.set(ReachyApp._MEM.KEY, saved);
    this.log('memory:', body.kind === 'digest' ? 'digest updated' : `+fact (${saved.facts.length} kept)`);
    return { status: 'ok', facts: saved.facts.length, digest: !!saved.digest };
  }

  /** Forget everything — for a "forget what we talked about" command. */
  async forgetMemory() {
    this.homey.settings.set(ReachyApp._MEM.KEY, { v: 1, facts: [], digest: '', updatedAt: Date.now() });
    this.log('memory: cleared');
    return { status: 'ok' };
  }

  /** Mechanical compaction — the only policy Homey applies to memory. */
  _compact(mem) {
    const C = ReachyApp._MEM;
    const today = this._dayKey();
    // 1. Age-out: keep only facts from the last KEEP_DAYS distinct days.
    const recentDays = new Set(
      [...new Set((mem.facts || []).map((f) => f && f.day).filter(Boolean))]
        .sort().reverse().slice(0, C.KEEP_DAYS),
    );
    let facts = (mem.facts || [])
      .filter((f) => f && f.text && (recentDays.has(f.day) || f.day === today))
      .map((f) => ({ t: f.t || 0, day: f.day || today, text: String(f.text).slice(0, C.FACT_CHARS) }))
      .sort((a, b) => a.t - b.t);
    // 2. Count cap: keep the newest FACT_CAP.
    if (facts.length > C.FACT_CAP) facts = facts.slice(-C.FACT_CAP);
    const out = {
      v: 1,
      facts,
      digest: String(mem.digest || '').slice(0, C.DIGEST_CHARS),
      updatedAt: mem.updatedAt || Date.now(),
    };
    // 3. Byte budget: evict oldest facts until the blob is under BUDGET.
    while (out.facts.length > 1 && JSON.stringify(out).length > C.BUDGET) out.facts.shift();
    return out;
  }

  /**
   * Resolve a natural-language command to target devices + an action and apply
   * it. Handles lights (on/off, brightness, colour, scenes), media/TV/speakers
   * (on/off, volume, mute, play/pause), and any other on/off device.
   * @param {string} command
   * @returns {Promise<string>} spoken-ready confirmation
   */
  async controlDevices(command) {
    const c = command.toLowerCase();
    const [zonesObj, devicesObj] = await Promise.all([
      this.api.zones.getZones(),
      this.api.devices.getDevices(),
    ]);
    const zones = Object.values(zonesObj);
    const devices = Object.values(devicesObj)
      .filter((d) => !String(d.driverUri || d.driverId || '').includes(SELF_URI));

    const { targets, label, reason } = this._resolveTargets(c, devices, zones);
    if (!targets.length) {
      return reason || "I couldn't tell which device or room you meant. Try naming a room, the TV, or the soundbar.";
    }

    const has = (d, cap) => Array.isArray(d.capabilities) && d.capabilities.includes(cap);
    const color = ReachyApp._detectColor(c);
    const temp = color ? null : ReachyApp._detectTemp(c);
    const brightness = ReachyApp._detectBrightness(c);
    const colorful = /colou?rful|rainbow|party/.test(c);
    const vol = ReachyApp._detectVolume(c);
    const media = /\bplay\b/.test(c) ? true : (/\bpause\b|\bstop\b/.test(c) ? false : null);
    const isOff = /\boff\b|turn off|switch off|shut off/.test(c);
    const isOn = /\bon\b|turn on|switch on|light up/.test(c);

    const lights = targets.filter((d) => d.class === 'light' && has(d, 'onoff'));

    // 1. Light scene (colour / brightness) — lights only.
    if ((colorful || color || temp || brightness !== null) && lights.length) {
      return this._applyLightScene(lights, { color, temp, brightness, colorful, label });
    }
    // 2. Volume / mute.
    if (vol) return this._applyVolume(targets, vol, label);
    // 3. Media play/pause.
    if (media !== null) {
      const t = targets.filter((d) => has(d, 'speaker_playing'));
      if (t.length) {
        await this._set(t, 'speaker_playing', media);
        return `${media ? 'Playing' : 'Paused'} ${label}.`;
      }
    }
    // 4. On / off.
    if (isOff || isOn) {
      const value = !isOff; // "off" wins if both somehow present
      const t = targets.filter((d) => has(d, 'onoff'));
      if (!t.length) return `I can't switch ${label} ${value ? 'on' : 'off'}.`;
      await this._set(t, 'onoff', value);
      const count = t.length > 1 ? ` (${t.length} devices)` : '';
      return `Turned ${value ? 'on' : 'off'} ${label}${count}.`;
    }
    return "I understood which device, but not what to do. Try on, off, volume, mute, or a colour.";
  }

  /** Work out which devices a command targets, with a spoken label. */
  _resolveTargets(c, devices, zones) {
    const everywhere = /\ball\b|\bevery\b|whole (?:house|home)|everywhere/.test(c);
    const byClass = (cls) => devices.filter((d) => d.class === cls);
    const nameHas = (re) => devices.filter((d) => re.test(String(d.name).toLowerCase()));

    let zone = null;
    for (const z of zones) {
      const zl = String(z.name).toLowerCase();
      if (zl !== 'home' && c.includes(zl)) { zone = z; break; }
    }
    const inZone = (d) => !zone || d.zone === zone.id;

    // Specific appliances / device classes.
    if (/apple ?tv/.test(c)) return { targets: nameHas(/apple ?tv/), label: 'the Apple TV' };
    if (/\btv\b|television|samsung/.test(c)) {
      const t = byClass('tv'); return { targets: t, label: t[0] ? `the ${t[0].name}` : 'the TV' };
    }
    if (/soundbar|sound ?bar|yamaha|\byas\b|sound system/.test(c)) {
      const t = byClass('speaker').concat(byClass('amplifier'));
      return { targets: t, label: t[0] ? `the ${t[0].name}` : 'the soundbar' };
    }
    if (/litter/.test(c)) return { targets: nameHas(/litter/), label: 'the Litter-Robot' };
    if (/\blights?\b|\blamp\b/.test(c)) {
      if (zone && !everywhere) {
        return { targets: byClass('light').filter(inZone), label: `the ${zone.name} lights` };
      }
      if (everywhere) return { targets: byClass('light'), label: 'all lights' };
      // No room matched: only blast "all lights" for a generic/absent qualifier,
      // not for an unrecognised room (e.g. "garage lights").
      const qm = c.match(/(\w+)\s+(?:lights?|lamps?)\b/);
      const qualifier = qm ? qm[1] : null;
      const generic = new Set(['the', 'all', 'my', 'your', 'our', 'some', 'any', 'these', 'those', 'room', 'house', 'home', 'on', 'off', 'up', 'down', 'a']);
      if (!qualifier || generic.has(qualifier)) return { targets: byClass('light'), label: 'all lights' };
      return { targets: [], label: '', reason: `I couldn't find a room called the ${qualifier}.` };
    }
    if (/\bspeakers?\b|\bstereo\b|\baudio\b/.test(c)) {
      return { targets: byClass('speaker'), label: 'the speakers' };
    }
    // "everything in the living room" / "turn off everything".
    if (/everything|all devices/.test(c) && (zone || everywhere)) {
      const t = devices.filter((d) => Array.isArray(d.capabilities) && d.capabilities.includes('onoff') && inZone(d));
      return { targets: t, label: (zone && !everywhere) ? `everything in the ${zone.name}` : 'everything' };
    }
    // Room named without a device type → that room's lights.
    if (zone) {
      return { targets: byClass('light').filter(inZone), label: `the ${zone.name} lights` };
    }
    if (everywhere) return { targets: byClass('light'), label: 'all lights' };
    return { targets: [], label: '' };
  }

  async _applyLightScene(lights, { color, temp, brightness, colorful, label }) {
    const n = lights.length;
    if (colorful) {
      await this._applyToLights(lights, (i) => [
        { capabilityId: 'onoff', value: true },
        { capabilityId: 'light_mode', value: 'color' },
        { capabilityId: 'light_saturation', value: 1 },
        { capabilityId: 'light_hue', value: i / Math.max(1, n) },
        { capabilityId: 'dim', value: brightness ?? 0.8 },
      ]);
      return `Set ${label} to a colorful scene (${n} lights).`;
    }
    const sets = [{ capabilityId: 'onoff', value: true }];
    const parts = [];
    if (color) {
      sets.push({ capabilityId: 'light_mode', value: 'color' },
        { capabilityId: 'light_saturation', value: color.sat },
        { capabilityId: 'light_hue', value: color.hue });
      parts.push(color.name);
    } else if (temp) {
      sets.push({ capabilityId: 'light_mode', value: 'temperature' },
        { capabilityId: 'light_temperature', value: temp.temperature });
      parts.push(temp.name);
    }
    if (brightness !== null) {
      sets.push({ capabilityId: 'dim', value: brightness });
      parts.push(`${Math.round(brightness * 100)} percent`);
    }
    await this._applyToLights(lights, () => sets);
    return `Set ${label} to ${parts.join(' at ')} (${n} lights).`;
  }

  async _applyVolume(targets, vol, label) {
    const has = (d, cap) => Array.isArray(d.capabilities) && d.capabilities.includes(cap);

    if (vol.type === 'mute' || vol.type === 'unmute') {
      const value = vol.type === 'mute';
      const t = targets.filter((d) => has(d, 'volume_mute'));
      if (!t.length) return `I can't mute ${label}.`;
      await this._set(t, 'volume_mute', value);
      return `${value ? 'Muted' : 'Unmuted'} ${label}.`;
    }
    if (vol.type === 'set') {
      const t = targets.filter((d) => has(d, 'volume_set'));
      if (!t.length) return `${label} doesn't support setting an exact volume.`;
      await this._set(t, 'volume_set', vol.value);
      return `Set ${label} volume to ${Math.round(vol.value * 100)} percent.`;
    }
    // up / down — step the button capability a few times for a noticeable change.
    const cap = vol.type === 'up' ? 'volume_up' : 'volume_down';
    const t = targets.filter((d) => has(d, cap));
    if (!t.length) return `I can't change the volume of ${label}.`;
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this._set(t, cap, true);
    }
    return `Turned ${label} volume ${vol.type}.`;
  }

  /** Apply capability sets (only those a device supports) to each device. */
  async _applyToLights(lights, setsFor) {
    const jobs = [];
    lights.forEach((d, i) => {
      for (const s of setsFor(i)) {
        if (d.capabilities.includes(s.capabilityId)) {
          jobs.push(this.api.devices.setCapabilityValue({
            deviceId: d.id, capabilityId: s.capabilityId, value: s.value,
          }));
        }
      }
    });
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) this.error('some device updates failed:', failed.length, failed[0].reason && failed[0].reason.message);
  }

  /** Set one capability on many devices. */
  async _set(devices, capabilityId, value) {
    const results = await Promise.allSettled(devices.map((d) => this.api.devices.setCapabilityValue({
      deviceId: d.id, capabilityId, value,
    })));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) this.error(`set ${capabilityId} failed on`, failed.length, failed[0].reason && failed[0].reason.message);
  }

  static _detectVolume(c) {
    if (/\bunmute\b/.test(c)) return { type: 'unmute' };
    if (/\bmute\b/.test(c)) return { type: 'mute' };
    const m = c.match(/volume (?:to |at )?(\d{1,3})/);
    if (m) return { type: 'set', value: Math.max(0, Math.min(100, parseInt(m[1], 10))) / 100 };
    const hasVol = /\bvolume\b/.test(c);
    if ((hasVol && /\b(up|higher|raise|increase)\b/.test(c)) || /\blouder\b|\bcrank\b/.test(c)) return { type: 'up' };
    if ((hasVol && /\b(down|lower|decrease)\b/.test(c)) || /\bquieter\b|\bsofter\b/.test(c)) return { type: 'down' };
    return null;
  }

  static _detectBrightness(c) {
    const m = c.match(/(\d{1,3})\s*(?:%|percent)/);
    if (m) return Math.max(0, Math.min(100, parseInt(m[1], 10))) / 100;
    if (/\b(dim|dimmer|darker|lower)\b|turn (?:it |the lights? )?down/.test(c)) return 0.3;
    if (/\b(bright|brighter|brighten|full|max|maximum)\b|turn (?:it |the lights? )?up/.test(c)) return 1.0;
    return null;
  }

  static _detectColor(c) {
    const COLORS = {
      red: 0.0, orange: 0.05, amber: 0.08, yellow: 0.15, lime: 0.25, green: 0.33,
      mint: 0.45, teal: 0.5, cyan: 0.5, turquoise: 0.5, blue: 0.66, indigo: 0.72,
      purple: 0.78, violet: 0.78, magenta: 0.85, pink: 0.92,
    };
    for (const [name, hue] of Object.entries(COLORS)) {
      if (new RegExp(`\\b${name}\\b`).test(c)) return { name, hue, sat: 1 };
    }
    return null;
  }

  static _detectTemp(c) {
    if (/warm white|warm|cozy|cosy/.test(c)) return { name: 'warm white', temperature: 1 };
    if (/cool white|cool|cold|daylight/.test(c)) return { name: 'cool white', temperature: 0 };
    if (/\bwhite\b/.test(c)) return { name: 'white', temperature: 0.5 };
    return null;
  }

};
