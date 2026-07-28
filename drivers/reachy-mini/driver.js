'use strict';

const Homey = require('homey');
const ReachyClient = require('../../lib/ReachyClient');

module.exports = class ReachyDriver extends Homey.Driver {

  async onInit() {
    this._registerFlowActions();
    // Device-scoped trigger cards; devices fire them via these references.
    this.faceDetectedTrigger = this.homey.flow.getDeviceTriggerCard('face_detected');
    this.heardSpeechTrigger = this.homey.flow.getDeviceTriggerCard('heard_speech');
    this.log('Reachy Mini driver initialized');
  }

  /**
   * Wire up the device-scoped Flow action cards once, delegating to the
   * matched device instance (resolved by Homey from the `device` arg).
   */
  _registerFlowActions() {
    const run = (id, fn) => this.homey.flow
      .getActionCard(id)
      .registerRunListener((args) => fn(args.device, args));

    run('say_text', (device, args) => device.say(args.text));
    run('announce_time', (device, args) => device.announceTime(args.format));
    run('announce_time_weather', (device) => device.announceTimeWeather());
    run('play_sound', (device, args) => device.playSound(args.file));
    run('set_volume', (device, args) => device.setVolumePercent(args.volume));
    run('wake_up', (device) => device.wakeUp());
    run('go_to_sleep', (device) => device.goToSleep());
    run('start_conversation', (device) => device.startConversation());
    run('stop_conversation', (device) => device.stopConversation());
    run('gesture_nod', (device) => device.nod());
    run('gesture_shake', (device) => device.shakeHead());
    run('gesture_look', (device, args) => device.look(args.direction));
    run('express_emotion', (device, args) => device.express(args.emotion));
    run('look_at_sound', (device) => device.lookAtSound());
  }

  /**
   * Custom pairing: the user enters their own Reachy Mini's address (each robot
   * has a different IP), and we verify it responds before adding the device.
   */
  onPair(session) {
    // Zero-config path: hand the pair view any Reachy Minis found via mDNS so
    // the user can add one with a single tap (no IP typing). Falls back to the
    // manual address entry below when discovery finds nothing.
    session.setHandler('list_discovered', async () => {
      const results = this.homey.discovery.getStrategy('reachy-mini').getDiscoveryResults();
      return Object.values(results || {}).map((r) => {
        const model = (r.txt && r.txt.model) || 'Reachy Mini';
        const robot = r.txt && r.txt.robot_name;
        return {
          id: r.id,
          address: `${r.address}:${r.port || 8000}`,
          name: robot ? `${model} (${robot})` : model,
        };
      });
    });

    session.setHandler('test_address', async (address) => {
      const addr = String(address || '').trim();
      const client = new ReachyClient(addr, { timeout: 6000 });
      const status = await client.getDaemonStatus(); // throws if unreachable
      const name = status.robot_name ? `Reachy Mini (${status.robot_name})` : 'Reachy Mini';
      this.log('Pairing: found', name, 'at', addr);
      // Returned to the pair view, which passes it straight to Homey.createDevice().
      return {
        name,
        data: { id: status.hardware_id || ReachyClient.normalizeBaseUrl(addr) },
        settings: { address: addr },
      };
    });
  }
};
