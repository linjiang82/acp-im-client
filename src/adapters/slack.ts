import pkg, { LogLevel } from '@slack/bolt';
const { App } = pkg;
import { BaseAdapter, type MessageContext } from './types.js';
import { pino } from 'pino';
import { splitText } from '../utils/text.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class SlackAdapter extends BaseAdapter {
  private app: any;
  private readonly MAX_MESSAGE_LENGTH = 4000;

  constructor(token: string, appToken: string) {
    super();
    this.app = new App({
      token: token,
      appToken: appToken,
      socketMode: true,
      // Use custom logger to reduce noise
      logLevel: LogLevel.INFO,
    });

    this.app.message(async ({ message }: any) => {
      logger.debug({ message }, 'Received Slack message event');
      if (!message.text || message.bot_id) return;

      const context: MessageContext = {
        platform: 'slack',
        channelId: message.channel,
        userId: message.user,
        text: message.text,
        threadId: message.thread_ts,
      };

      if (this.onMessage) {
        await this.onMessage(context);
      }
    });

    this.app.event('app_mention', async ({ event }: any) => {
      logger.debug({ event }, 'Received Slack app_mention event');
      if (!event.text) return;

      // Strip the mention from the text (e.g. <@U123456> hello -> hello)
      const cleanText = event.text.replace(/<@U[A-Z0-9]+>/g, '').trim();

      const context: MessageContext = {
        platform: 'slack',
        channelId: event.channel,
        userId: event.user,
        text: cleanText,
        threadId: event.thread_ts || event.ts,
      };

      if (this.onMessage) {
        await this.onMessage(context);
      }
    });
  }

  public async start(): Promise<void> {
    logger.info('Starting Slack adapter');
    await this.app.start();
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Slack adapter');
    await this.app.stop();
  }

  public async sendReply(context: MessageContext, text: string): Promise<void> {
    const chunks = splitText(text, this.MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        try {
          logger.debug({ channel: context.channelId, chunkLength: chunk.length }, 'Sending Slack message');
          await this.app.client.chat.postMessage({
            channel: context.channelId,
            text: chunk,
            thread_ts: context.threadId,
          });
        } catch (err) {
          logger.error({ err, context }, 'Failed to send Slack message');
        }
      }
    }
  }
}
