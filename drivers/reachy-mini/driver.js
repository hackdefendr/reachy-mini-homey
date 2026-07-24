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
    let discovered = null;

    session.setHandler('test_address', async (address) => {
      const addr = String(address || '').trim();
      const client = new ReachyClient(addr, { timeout: 6000 });
      const status = await client.getDaemonStatus(); // throws if unreachable
      const name = status.robot_name ? `Reachy Mini (${status.robot_name})` : 'Reachy Mini';
      discovered = {
        name,
        data: { id: status.hardware_id || ReachyClient.normalizeBaseUrl(addr) },
        settings: { address: addr },
      };
      this.log('Pairing: found', name, 'at', addr);
      return { name };
    });

    session.setHandler('list_devices', async () => (discovered ? [discovered] : []));
  }
};
