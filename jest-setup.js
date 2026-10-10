// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// The scaffolded setup gives jsdom Node's MessageChannel for React's scheduler. Its ports keep Jest
// from exiting once a test has rendered React, so close them when the test file is done.
const { MessageChannel: NodeMessageChannel } = require('worker_threads');
const channels = [];
global.MessageChannel = class extends NodeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
afterAll(() => channels.forEach((channel) => channel.port1.close()));
