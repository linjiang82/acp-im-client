export interface MessageContext {
  platform: string;
  channelId: string;
  userId: string;
  text: string;
  threadId?: string;
}

export abstract class BaseAdapter {
  protected onMessage?: (context: MessageContext) => Promise<void>;

  public setMessageHandler(handler: (context: MessageContext) => Promise<void>): void {
    this.onMessage = handler;
  }

  public abstract start(): Promise<void>;
  public abstract stop(): Promise<void>;
  public abstract sendReply(context: MessageContext, text: string): Promise<void>;
}
