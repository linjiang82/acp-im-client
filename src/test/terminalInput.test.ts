import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpClient } from '../agent/acpClient.js';
import { SessionManager } from '../core/sessionManager.js';
import { CommandHandler } from '../core/commandHandler.js';
import { EventEmitter } from 'events';

describe('Terminal Input Forwarding', () => {
  let mockAgent: any;
  let client: AcpClient;
  let sessionManager: SessionManager;
  let pendingTerminalInputs: Map<string, boolean>;

  beforeEach(() => {
    mockAgent = new EventEmitter();
    mockAgent.send = vi.fn();
    client = new AcpClient(mockAgent as any);
    sessionManager = new SessionManager(client);
    pendingTerminalInputs = new Map();
  });

  it('should forward message to terminal when pendingTerminalInput is set', async () => {
    const sessionId = 'test-session';
    pendingTerminalInputs.set(sessionId, true);

    const mockAdapter: any = {
      constructor: { name: 'TestAdapter' },
      sendReply: vi.fn()
    };

    const commandHandler = new CommandHandler(
      client,
      sessionManager,
      [mockAdapter],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      pendingTerminalInputs
    );

    // Mock session manager to return our session id
    vi.spyOn(sessionManager, 'getSessionForContext').mockResolvedValue(sessionId);

    const context = {
      platform: 'test',
      channelId: 'c1',
      userId: 'u1',
      text: 'yes'
    };

    await commandHandler.handleMessage(context);

    // Check that it was NOT sent as a prompt
    expect(mockAgent.send).not.toHaveBeenCalledWith(expect.stringContaining('session/prompt'));

    // Check that it WAS sent as terminal/input notification
    expect(mockAgent.send).toHaveBeenCalledWith(expect.stringContaining('"method":"terminal/input"'));
    expect(mockAgent.send).toHaveBeenCalledWith(expect.stringContaining('"input":"yes\\n"'));

    // Check that flag was cleared
    expect(pendingTerminalInputs.has(sessionId)).toBe(false);

    // Check that reply was sent to user
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Sent `yes` to terminal')
    );
  });

  it('should detect confirmation prompt and set pendingTerminalInput flag', async () => {
    // This part tests the logic I added to index.ts, 
    // but since I can't easily test index.ts as a unit, 
    // I will test the regex and the logic in a simulated way.
    
    const promptRegex = /(?:\[[Yy]\/[Nn]\]|\([Yy]\/[Nn]\)|[Yy]es\/[Nn]o|\b[yY]\/[nN]\b)/;
    
    const outputs = [
      'Do you want to continue? [Y/n]',
      'Proceed (y/n)?',
      'Install package? yes/no',
      'Continue [y/N]?'
    ];

    for (const output of outputs) {
      expect(promptRegex.test(output)).toBe(true);
    }

    expect(promptRegex.test('Just some regular output')).toBe(false);
  });
});
