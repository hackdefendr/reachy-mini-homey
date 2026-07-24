'use strict';

/**
 * Thin wrapper around the Reachy Mini daemon HTTP API.
 *
 * The daemon exposes a FastAPI service (default port 8000). This client only
 * covers the endpoints the Homey app needs for Eyes, Ears and Voice. It is
 * deliberately dependency-free (uses global `fetch`/`FormData`, available on
 * the Node.js runtime Homey ships) so it can be unit-tested outside Homey.
 */
module.exports = class ReachyClient {

  /**
   * @param {string} address - Host and port, e.g. "10.71.1.154:8000".
   *                           A bare host defaults to port 8000. A full
   *                           "http://host:port" URL is also accepted.
   * @param {object} [opts]
   * @param {number} [opts.timeout=8000] - Per-request timeout in ms.
   */
  constructor(address, opts = {}) {
    this.baseUrl = ReachyClient.normalizeBaseUrl(address);
    this.timeout = opts.timeout ?? 8000;
  }

  static normalizeBaseUrl(address) {
    let a = String(address || '').trim();
    if (!a) throw new Error('Reachy address is empty');
    if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
    // Ensure a port is present; the daemon defaults to 8000.
    const url = new URL(a);
    if (!url.port) url.port = '8000';
    return `${url.protocol}//${url.host}`;
  }

  /** Low-level request helper with timeout and JSON handling. */
  async _request(method, path, { json, form, expectJson = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const init = { method, signal: controller.signal, headers: {} };
      if (json !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(json);
      } else if (form !== undefined) {
        init.body = form; // FormData sets its own Content-Type boundary.
      }
      const res = await fetch(`${this.baseUrl}${path}`, init);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Reachy ${method} ${path} -> ${res.status} ${res.statusText} ${text}`.trim());
      }
      if (!expectJson) return res;
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Health / state -------------------------------------------------------

  /** Full daemon status object (robot name, version, backend status, ...). */
  getDaemonStatus() {
    return this._request('GET', '/api/daemon/status');
  }

  /** Quick reachability probe. Returns true if the daemon answers. */
  async ping() {
    try {
      await this.getDaemonStatus();
      return true;
    } catch (_err) {
      return false;
    }
  }

  getFullState() {
    return this._request('GET', '/api/state/full');
  }

  /**
   * Direction-of-arrival of the dominant sound source.
   * Requires the daemon to own the mic (media acquired, no camera app running).
   * @returns {Promise<{angle:number, speech_detected:boolean}>} angle in radians.
   */
  getDoa() {
    return this._request('GET', '/api/state/doa');
  }

  /** Acquire the shared media (camera/mic) for the daemon. */
  acquireMedia() {
    return this._request('POST', '/api/media/acquire');
  }

  /** Release the shared media held by the daemon. */
  releaseMedia() {
    return this._request('POST', '/api/media/release');
  }

  // --- Volume ---------------------------------------------------------------

  /** @returns {Promise<{volume:number}>} volume is 0-100. */
  getVolume() {
    return this._request('GET', '/api/volume/current');
  }

  /** @param {number} volume 0-100 (clamped). */
  setVolume(volume) {
    const v = Math.max(0, Math.min(100, Math.round(volume)));
    return this._request('POST', '/api/volume/set', { json: { volume: v } });
  }

  // --- Sound / Voice --------------------------------------------------------

  listSounds() {
    return this._request('GET', '/api/media/sounds');
  }

  /**
   * Upload an audio buffer to the daemon's temp sounds directory.
   * @param {Buffer|Uint8Array} buffer
   * @param {string} filename - e.g. "homey-tts.mp3".
   * @param {string} [mime="audio/mpeg"]
   * @returns {Promise<{status:string, path:string}>}
   */
  uploadSound(buffer, filename, mime = 'audio/mpeg') {
    const form = new FormData();
    const blob = new Blob([buffer], { type: mime });
    form.append('file', blob, filename);
    return this._request('POST', '/api/media/sounds/upload', { form });
  }

  /**
   * Play a sound file already known to the daemon.
   * @param {string} file - uploaded filename, built-in asset name, or absolute path.
   */
  playSound(file) {
    return this._request('POST', '/api/media/play_sound', { json: { file } });
  }

  stopSound() {
    return this._request('POST', '/api/media/stop_sound');
  }

  /** Upload then immediately play. Returns the playback response. */
  async uploadAndPlay(buffer, filename, mime = 'audio/mpeg') {
    await this.uploadSound(buffer, filename, mime);
    return this.playSound(filename);
  }

  // --- Motion ---------------------------------------------------------------

  wakeUp() {
    return this._request('POST', '/api/move/play/wake_up');
  }

  goToSleep() {
    return this._request('POST', '/api/move/play/goto_sleep');
  }

  stopMove() {
    return this._request('POST', '/api/move/stop');
  }

  /** @returns {Promise<{mode:'enabled'|'disabled'|'gravity_compensation'}>} */
  getMotorStatus() {
    return this._request('GET', '/api/motors/status');
  }

  /**
   * Set the motor control mode.
   * @param {'enabled'|'disabled'|'gravity_compensation'} mode
   *   "enabled" holds position (prevents the head/antennas drooping into standby).
   */
  setMotorMode(mode) {
    return this._request('POST', `/api/motors/set_mode/${encodeURIComponent(mode)}`);
  }

  /**
   * Move head / antennas / body over `duration` seconds.
   * @param {object} target
   * @param {object} [target.head_pose] {x,y,z,roll,pitch,yaw} (metres / radians)
   * @param {[number,number]} [target.antennas] left/right antenna angles (radians)
   * @param {number} [target.body_yaw] radians
   * @param {number} [duration=1.0] seconds
   * @param {string} [interpolation="minjerk"]
   */
  goto(target = {}, duration = 1.0, interpolation = 'minjerk') {
    return this._request('POST', '/api/move/goto', {
      json: { ...target, duration, interpolation },
    });
  }

  // --- Apps (mode switching) ------------------------------------------------

  /** Status of the currently running robot app (or null when none). */
  getCurrentApp() {
    return this._request('GET', '/api/apps/current-app-status');
  }

  /** @returns {Promise<{startup_app: string|null}>} */
  getStartupApp() {
    return this._request('GET', '/api/apps/startup-app');
  }

  /** Start a robot app by name. Only one app can run at a time. */
  startApp(name) {
    return this._request('POST', `/api/apps/start-app/${encodeURIComponent(name)}`);
  }

  /** Stop the currently running app (no-op if none). */
  stopCurrentApp() {
    return this._request('POST', '/api/apps/stop-current-app');
  }

  /**
   * Switch the robot to `name`, stopping any app already running first
   * (start-app rejects with "already running" otherwise).
   */
  async switchToApp(name) {
    await this.stopCurrentApp().catch(() => {});
    return this.startApp(name);
  }

  // --- Vision (Eyes) --------------------------------------------------------

  enableFaceTracking(weight = 1.0) {
    return this._request('POST', '/api/media/tracking/enable', { json: { weight } });
  }

  disableFaceTracking() {
    return this._request('POST', '/api/media/tracking/disable');
  }

  /** @returns {Promise<{detected:boolean, x?:number, y?:number}>} */
  getTrackedFace() {
    return this._request('GET', '/api/media/tracking/face');
  }
};
