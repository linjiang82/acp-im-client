import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandHandler } from '../core/commandHandler.js';
import { SessionManager } from '../core/sessionManager.js';
import { type MessageContext } from '../adapters/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('Directory Creation Confirmation', () => {
  let sessionManager: SessionManager;
  let commandHandler: CommandHandler;
  let mockClient: any;
  let mockAdapter: any;

  beforeEach(() => {
    mockClient = {
      newSession: vi.fn().mockResolvedValue({ sessionId: 'test-s1' }),
      on: vi.fn(),
    };
    sessionManager = new SessionManager(mockClient as any);
    mockAdapter = {
      constructor: { name: 'MockAdapter' },
      sendReply: vi.fn(),
    };
    commandHandler = new CommandHandler(
      mockClient as any,
      sessionManager,
      [mockAdapter],
      new Map(),
      new Map(),
      new Map(),
      new Map()
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should prompt to create directory if it does not exist', async () => {
    const nonExistentPath = '/tmp/new-dir';
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const context: MessageContext = { 
      platform: 'mock', 
      channelId: 'c1', 
      userId: 'u1', 
      text: `/session new ${nonExistentPath}` 
    };

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining(`Directory \`${nonExistentPath}\` does not exist`)
    );
  });

  it('should create directory and start session when user says yes', async () => {
    const nonExistentPath = '/tmp/new-dir';
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const context1: MessageContext = { 
      platform: 'mock', 
      channelId: 'c1', 
      userId: 'u1', 
      text: `/session new ${nonExistentPath}` 
    };

    await commandHandler.handleMessage(context1);

    const context2: MessageContext = { 
      platform: 'mock', 
      channelId: 'c1', 
      userId: 'u1', 
      text: 'yes' 
    };

    await commandHandler.handleMessage(context2);

    expect(fs.mkdirSync).toHaveBeenCalledWith(nonExistentPath, { recursive: true });
    expect(mockClient.newSession).toHaveBeenCalledWith(nonExistentPath);
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context2,
      expect.stringContaining('Directory created')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context2,
      expect.stringContaining('New session started')
    );
  });

  it('should cancel session creation when user says no', async () => {
    const nonExistentPath = '/tmp/new-dir';
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const context1: MessageContext = { 
      platform: 'mock', 
      channelId: 'c1', 
      userId: 'u1', 
      text: `/session new ${nonExistentPath}` 
    };

    await commandHandler.handleMessage(context1);

    const context2: MessageContext = { 
      platform: 'mock', 
      channelId: 'c1', 
      userId: 'u1', 
      text: 'no' 
    };

    await commandHandler.handleMessage(context2);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(mockClient.newSession).not.toHaveBeenCalled();
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context2,
      expect.stringContaining('Session creation cancelled')
    );
  });
});
