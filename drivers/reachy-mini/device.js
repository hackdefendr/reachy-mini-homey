'use strict';

const Homey = require('homey');
const ReachyClient = require('../../lib/ReachyClient');
const tts = require('../../lib/tts');
const weather = require('../../lib/weather');

const POLL_INTERVAL = 30 * 1000; // ms
const MOTION_POLL_INTERVAL = 1000; // ms
const MOTION_THRESHOLD = 0.25; // rad (~14°) of head/body yaw = "looking at something"
const DOA_POLL_INTERVAL = 500; // ms
const DOA_COOLDOWN = 2500; // ms minimum between heard_speech fires
const TTS_FILENAME = 'homey-tts.mp3';
const CONVERSATION_APP = 'reachy_mini_conversation_app';
const HEAL_COOLDOWN = 90 * 1000; // ms minimum between self-heal attempts

// Head pose to look in a direction (radians). 90° DOA ≈ front.
const LOOK_POSES = {
  left: { yaw: 0.6 },
  right: { yaw: -0.6 },
  up: { pitch: -0.35 },
  down: { pitch: 0.35 },
  center: {},
};

// Gesture / emotion sequences. Each step is a partial head pose (roll/pitch/yaw)
// plus optional `antennas` [left,right] and `dur` (seconds) for that step.
const GESTURES = {
  nod: [{ pitch: 0.28, dur: 0.35 }, { pitch: -0.12, dur: 0.35 }, { pitch: 0.22, dur: 0.3 }, { pitch: 0, dur: 0.3 }],
  shake: [{ yaw: 0.4, dur: 0.32 }, { yaw: -0.4, dur: 0.32 }, { yaw: 0.28, dur: 0.28 }, { yaw: 0, dur: 0.3 }],
};
const EMOTIONS = {
  happy: [{ antennas: [0.7, -0.7], pitch: -0.1, dur: 0.25 }, { antennas: [-0.7, 0.7], dur: 0.28 }, { antennas: [0.6, -0.6], dur: 0.28 }, { antennas: [0, 0], pitch: 0, dur: 0.3 }],
  sad: [{ pitch: 0.3, antennas: [-0.8, -0.8], dur: 0.6 }, { dur: 0.5 }, { pitch: 0, antennas: [0, 0], dur: 0.6 }],
  curious: [{ roll: 0.35, antennas: [0.5, -0.2], dur: 0.5 }, { roll: 0, antennas: [0, 0], dur: 0.5 }],
  excited: [{ antennas: [0.8, -0.8], pitch: -0.15, dur: 0.18 }, { antennas: [-0.8, 0.8], pitch: 0.05, dur: 0.18 }, { antennas: [0.8, -0.8], dur: 0.18 }, { antennas: [-0.8, 0.8], dur: 0.18 }, { antennas: [0, 0], pitch: 0, dur: 0.25 }],
  confused: [{ roll: 0.3, yaw: 0.15, antennas: [0.4, -0.1], dur: 0.55 }, { roll: -0.2, yaw: -0.1, dur: 0.5 }, { roll: 0, yaw: 0, antennas: [0, 0], dur: 0.5 }],
};

module.exports = class ReachyDevice extends Homey.Device {

  async onInit() {
    this._buildClient();

    this.registerCapabilityListener('onoff', async (value) => {
      return value ? this.wakeUp() : this.goToSleep();
    });
    this.registerCapabilityListener('volume_set', async (value) => {
      // volume_set is 0..1; Reachy expects 0..100.
      return this.setVolumePercent(Math.round(value * 100), { updateCapability: false });
    });

    await this._syncFromRobot();
    this._poll = this.homey.setInterval(() => this._pollTick(), POLL_INTERVAL);

    await this._applyVision();
    await this._applyEars();
    this.log('Reachy device initialized at', this.getSetting('address'));
  }

  _buildClient(address = this.getSetting('address')) {
    this.client = new ReachyClient(address, { timeout: 8000 });
  }

  // NB: during onSettings, this.getSetting() still returns the OLD value, so we
  // must apply the values from the `newSettings` argument.
  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address')) {
      this._buildClient(newSettings.address);
      await this._syncFromRobot();
    }
    if (changedKeys.includes('face_detection')) {
      await this._applyVision(newSettings.face_detection);
    }
    if (changedKeys.includes('listen_doa')) {
      await this._applyEars(newSettings.listen_doa);
    }
  }

  onUninit() {
    this._teardown();
  }

  onDeleted() {
    this._teardown();
  }

  _teardown() {
    if (this._poll) this.homey.clearInterval(this._poll);
    this._stopMotionPoll();
    this._stopDoaPoll();
  }

  /** Periodic tick: keep availability/volume in sync and self-heal droop. */
  async _pollTick() {
    await this._syncFromRobot();
    await this._selfHealDroop();
  }

  /**
   * Self-heal the "app running on a relaxed robot" droop. It can occur when the
   * robot reboots and auto-starts its startup app (e.g. the face-tracker) on a
   * sleeping robot: the app owns the robot but the motors stay relaxed, so the
   * head droops into standby. If a non-conversation app is running with the
   * motors disabled and the head drooped — and the user hasn't put Reachy to
   * sleep — wake the robot and restart the app so it holds its head up.
   */
  async _selfHealDroop() {
    if (this.getCapabilityValue('onoff') === false) return; // intentionally asleep
    if (Date.now() - (this._lastHeal || 0) < HEAL_COOLDOWN) return;

    try {
      const status = await this.client.getCurrentApp();
      const appName = status && status.info && status.info.name;
      if (!appName || appName === CONVERSATION_APP) return; // no app / conversation: leave alone

      const motors = await this.client.getMotorStatus();
      // A healthy tracker keeps motors 'enabled' to hold/move the head. Motors
      // 'disabled' while a (non-conversation) app runs means it isn't actually
      // controlling the robot — the drooped/standby state we heal.
      if (!motors || motors.mode !== 'disabled') return;

      const state = await this.client.getFullState().catch(() => ({}));
      const pitch = state && state.head_pose ? state.head_pose.pitch : null;

      this._lastHeal = Date.now();
      this.log(`Self-heal: '${appName}' running but motors relaxed${pitch != null ? ` (head pitch ${pitch.toFixed(2)})` : ''}; waking and restarting it`);
      await this.client.stopCurrentApp().catch(() => {});
      await this.stayAwake();
      await this.client.startApp(appName);
      this.log('Self-heal: robot woken and', appName, 'restarted');
    } catch (err) {
      this.error('Self-heal check failed:', err.message);
    }
  }

  /** Update availability + volume capability from the live robot. */
  async _syncFromRobot() {
    try {
      const { volume } = await this.client.getVolume();
      await this.setCapabilityValue('volume_set', Math.max(0, Math.min(1, volume / 100)));
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      await this.setUnavailable(this.homey.__('device.unreachable') || 'Reachy is unreachable').catch(() => {});
      this.error('Sync failed:', err.message);
    }
  }

  // --- Actions used by Flow cards & capabilities ----------------------------

  /**
   * Synthesize `text` to speech and play it through Reachy's speaker.
   * @param {string} text
   */
  async say(text) {
    const message = String(text || '').trim();
    if (!message) throw new Error('Nothing to say');

    const provider = this.getSetting('tts_provider') || 'openai';
    const model = this.getSetting('tts_model') || 'tts-1-hd';
    const voice = provider === 'elevenlabs'
      ? (this.getSetting('tts_elevenlabs_voice') || undefined)
      : (this.getSetting('tts_voice') || undefined);
    this.log(`Synthesizing via ${provider}${provider === 'openai' ? ` (${model}/${voice || 'onyx'})` : ''}`);
    let audio;
    try {
      audio = await tts.synthesize(message, {
        provider,
        model,
        lang: this.getSetting('tts_lang') || 'en',
        voice,
        apiKey: this.getSetting('tts_api_key') || undefined,
        onFallback: (p, err) => this.log(`TTS ${p} unavailable (${err.message}); using Google voice`),
      });
    } catch (err) {
      this.error(`TTS failed:`, err.message);
      throw err;
    }

    // Fire the antenna wiggle alongside playback (best-effort, non-blocking).
    if (this.getSetting('speak_gesture')) this._wiggleAntennas();

    await this.client.uploadAndPlay(audio, TTS_FILENAME);
    this.log('Said:', message);
  }

  /**
   * Speak just the current time.
   * @param {'device'|'12'|'24'} [format='device'] clock format; 'device' uses
   *        the device's configured default.
   */
  async announceTime(format = 'device') {
    const timeStr = this._formatTime(format);
    return this.say(`It's ${timeStr}.`);
  }

  /** Speak the current time and weather, cuckoo-clock style. */
  async announceTimeWeather() {
    const sentence = await this._composeTimeWeather();
    return this.say(sentence);
  }

  /**
   * Format the current time in the Homey's timezone.
   * @param {'device'|'12'|'24'} [format='device']
   * @returns {string} e.g. "3:15 PM" or "15:15"
   */
  _formatTime(format = 'device') {
    const clock = format === 'device' ? (this.getSetting('clock') || '12') : format;
    const tz = this.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: clock === '12',
      timeZone: tz,
    }).format(new Date());
  }

  async _composeTimeWeather() {
    const units = this.getSetting('units') || 'fahrenheit';
    const timeStr = this._formatTime('device');

    let weatherStr = '';
    try {
      const lat = this.homey.geolocation.getLatitude();
      const lon = this.homey.geolocation.getLongitude();
      if (lat != null && lon != null) {
        const w = await weather.getCurrent(lat, lon, { unit: units });
        weatherStr = ` It's ${w.temperature} degrees and ${w.description}.`;
      }
    } catch (err) {
      this.error('Weather lookup failed:', err.message);
    }

    return `It's ${timeStr}.${weatherStr}`;
  }

  async playSound(file) {
    if (!file) throw new Error('No sound file specified');
    return this.client.playSound(file);
  }

  /**
   * @param {number} percent 0-100
   * @param {object} [opts]
   * @param {boolean} [opts.updateCapability=true]
   */
  async setVolumePercent(percent, opts = {}) {
    await this.client.setVolume(percent);
    if (opts.updateCapability !== false) {
      await this.setCapabilityValue('volume_set', Math.max(0, Math.min(1, percent / 100)));
    }
  }

  async wakeUp() {
    await this.client.setMotorMode('enabled').catch(() => {});
    await this.client.wakeUp();
    await this.setCapabilityValue('onoff', true).catch(() => {});
  }

  /**
   * Keep Reachy awake and holding a neutral posture (motors enabled) instead of
   * relaxing into standby, where the head and antennas droop.
   */
  async stayAwake() {
    await this.client.setMotorMode('enabled').catch((err) => this.error('setMotorMode failed:', err.message));
    await this.client.goto({ head_pose: this._headPose({}), antennas: [0, 0], body_yaw: 0 }, 1.0)
      .catch((err) => this.error('neutral pose failed:', err.message));
  }

  async goToSleep() {
    await this.client.goToSleep();
    await this.setCapabilityValue('onoff', false).catch(() => {});
  }

  // --- Conversation mode (two-way voice) ------------------------------------

  /**
   * Switch Reachy into the conversation app for two-way voice. Only one robot
   * app runs at a time, so this stops the eyes/face-tracker first.
   */
  async startConversation() {
    await this.client.switchToApp(CONVERSATION_APP);
    this.log('Conversation mode started');
  }

  /**
   * Stop the conversation app and resume the robot's startup app (the eyes /
   * face-tracker), so Reachy returns to its resting behaviour.
   */
  async stopConversation() {
    await this.client.stopCurrentApp().catch(() => {});
    let startup = null;
    try {
      const res = await this.client.getStartupApp();
      startup = res && res.startup_app;
    } catch (_err) { /* ignore */ }
    if (startup && startup !== CONVERSATION_APP) {
      // Wake the robot BEFORE starting the app. Apps like the face-tracker take
      // over the motors in whatever state they find them; starting on a relaxed
      // robot leaves the head drooping in standby. Waking first (motors enabled
      // + neutral pose) ensures it holds its head up.
      await this.stayAwake();
      await this.client.startApp(startup)
        .catch((err) => this.error('Failed to resume startup app:', err.message));
      this.log('Conversation stopped; woke robot and resumed startup app:', startup);
    } else {
      // No other app to hold the robot — keep it awake instead of drooping.
      await this.stayAwake();
      this.log('Conversation stopped; holding awake posture');
    }
  }

  // --- Expressive motion (gestures & emotions) ------------------------------

  async nod() { return this._playSequence(GESTURES.nod); }

  async shakeHead() { return this._playSequence(GESTURES.shake); }

  /** @param {'left'|'right'|'up'|'down'|'center'} direction */
  async look(direction) {
    const pose = LOOK_POSES[direction] || LOOK_POSES.center;
    return this.client.goto({ head_pose: this._headPose(pose) }, 0.5);
  }

  /** @param {string} emotion key of EMOTIONS */
  async express(emotion) {
    const seq = EMOTIONS[emotion];
    if (!seq) throw new Error(`Unknown emotion: ${emotion}`);
    return this._playSequence(seq);
  }

  /** Turn the head toward the most recently heard speech direction. */
  async lookAtSound() {
    if (this._lastDoaAngle == null) {
      this.log('look_at_sound: no sound direction recorded yet');
      return undefined;
    }
    // 90° (DOA front) maps to yaw 0; clamp to a safe head range.
    let yaw = ((90 - this._lastDoaAngle) * Math.PI) / 180;
    yaw = Math.max(-0.9, Math.min(0.9, yaw));
    this.log(`look_at_sound: turning to ${this._lastDoaAngle}° (yaw ${yaw.toFixed(2)})`);
    return this.client.goto({ head_pose: this._headPose({ yaw }) }, 0.6);
  }

  /** Fill a partial {roll,pitch,yaw} into a full head pose. */
  _headPose(partial = {}) {
    return { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, ...partial };
  }

  _sleep(ms) {
    return new Promise((resolve) => this.homey.setTimeout(resolve, ms));
  }

  /** Play a sequence of gesture steps, waiting for each to complete. */
  async _playSequence(steps) {
    for (const step of steps) {
      const { antennas, body_yaw: bodyYaw, dur = 0.4, ...rp } = step;
      const target = {};
      if (Object.keys(rp).length) target.head_pose = this._headPose(rp);
      if (antennas) target.antennas = antennas;
      if (bodyYaw !== undefined) target.body_yaw = bodyYaw;
      // eslint-disable-next-line no-await-in-loop
      await this.client.goto(target, dur);
      // eslint-disable-next-line no-await-in-loop
      await this._sleep(dur * 1000 + 60);
    }
  }

  // --- Vision (Eyes): head-motion face proxy --------------------------------
  // The Reachy daemon has no readable face-detection signal (its `face_target`
  // is not populated by the community tracker apps — see project notes). As a
  // pragmatic proxy, when a face-tracking app is running on the robot it swings
  // the head/body to follow a face; we watch that motion via the daemon state
  // API and fire the "A face appeared" trigger when the head turns to track.
  // NB: only works while a head-moving tracker app runs, and won't catch a face
  // held dead-centre (no head movement). It's inference, not true detection.

  /** Start/stop the motion-proxy poll based on the "Watch for faces" setting. */
  async _applyVision(watch = this.getSetting('face_detection')) {
    this._headTurned = false;
    if (watch) {
      this._startMotionPoll();
      this.log('Head-motion face proxy enabled');
    } else {
      this._stopMotionPoll();
      this.log('Head-motion face proxy disabled');
    }
  }

  _startMotionPoll() {
    if (this._motionPoll) return;
    this._motionPoll = this.homey.setInterval(() => this._pollMotion(), MOTION_POLL_INTERVAL);
  }

  _stopMotionPoll() {
    if (this._motionPoll) {
      this.homey.clearInterval(this._motionPoll);
      this._motionPoll = null;
    }
  }

  /**
   * Read the robot's head/body pose; if it has turned past the threshold
   * (a tracker following a face), fire the trigger on the rising edge.
   */
  async _pollMotion() {
    let state;
    try {
      state = await this.client.getFullState();
    } catch (_err) {
      return; // transient; retry next tick
    }
    const head = state.head_pose || {};
    const headYaw = Math.abs(head.yaw ?? 0);
    const bodyYaw = Math.abs(state.body_yaw ?? 0);
    const turned = Math.max(headYaw, bodyYaw) > MOTION_THRESHOLD;

    // Fire only on the centred -> turned transition.
    if (turned && !this._headTurned) {
      this.driver.faceDetectedTrigger
        .trigger(this, { x: head.yaw ?? 0, y: head.pitch ?? 0 })
        .catch((err) => this.error('face_detected trigger failed:', err.message));
      this.log('Head-motion proxy fired (yaw:', head.yaw, ')');
    }
    this._headTurned = turned;
  }

  // --- Hearing (Ears): direction-of-arrival ---------------------------------
  // The daemon computes DOA + a speech-activity flag from the mic array, but
  // only while it owns the mic (media acquired, no camera app running). When
  // "Listen for sounds" is on we acquire media and poll /api/state/doa, firing
  // "Heard someone speak" on each speech onset with the direction it came from.

  /** Start/stop DOA listening based on the "Listen for sounds" setting. */
  async _applyEars(listen = this.getSetting('listen_doa')) {
    this._speaking = false;
    this._lastSpeechFire = 0;
    if (listen) {
      await this.client.acquireMedia().catch((err) => this.error('acquireMedia failed:', err.message));
      this._startDoaPoll();
      this.log('Ears (DOA) listening enabled');
    } else {
      this._stopDoaPoll();
      this.log('Ears (DOA) listening disabled');
    }
  }

  _startDoaPoll() {
    if (this._doaPoll) return;
    this._doaPoll = this.homey.setInterval(() => this._pollDoa(), DOA_POLL_INTERVAL);
  }

  _stopDoaPoll() {
    if (this._doaPoll) {
      this.homey.clearInterval(this._doaPoll);
      this._doaPoll = null;
    }
  }

  /** Poll DOA and fire "Heard someone speak" on each speech onset. */
  async _pollDoa() {
    let doa;
    try {
      doa = await this.client.getDoa();
    } catch (_err) {
      return; // transient; retry next tick
    }
    const speaking = !!(doa && doa.speech_detected);

    if (speaking && !this._speaking && (Date.now() - this._lastSpeechFire) > DOA_COOLDOWN) {
      const deg = Math.round(((doa.angle ?? 0) * 180) / Math.PI);
      const label = ReachyDevice._directionLabel(deg);
      this._lastDoaAngle = deg; // remembered for "look toward the last sound"
      this._lastSpeechFire = Date.now();
      this.driver.heardSpeechTrigger
        .trigger(this, { direction: deg, direction_label: label })
        .catch((err) => this.error('heard_speech trigger failed:', err.message));
      this.log(`Heard speech from ${deg}° (${label})`);
    }
    this._speaking = speaking;
  }

  /** Coarse direction label. 90° ≈ front (robot's mic-array convention). */
  static _directionLabel(deg) {
    const d = ((deg % 360) + 360) % 360;
    if (d >= 45 && d < 135) return 'front';
    if (d >= 135 && d < 225) return 'left';
    if (d >= 225 && d < 315) return 'behind';
    return 'right';
  }

  /** Best-effort playful antenna motion while speaking. */
  _wiggleAntennas() {
    (async () => {
      try {
        await this.client.goto({ antennas: [0.35, -0.35] }, 0.25);
        await this.client.goto({ antennas: [-0.35, 0.35] }, 0.3);
        await this.client.goto({ antennas: [0, 0] }, 0.25);
      } catch (err) {
        this.error('Antenna wiggle failed:', err.message);
      }
    })();
  }
};
