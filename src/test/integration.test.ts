import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpClient } from '../agent/acpClient.js';
import { SessionManager } from '../core/sessionManager.js';
import { CommandHandler } from '../core/commandHandler.js';
import { EventEmitter } from 'events';

describe('Integration: Session Turn', () => {
  let mockAgent: any;
  let client: AcpClient;
  let sessionManager: SessionManager;

  beforeEach(() => {
    mockAgent = new EventEmitter();
    mockAgent.send = vi.fn((msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.method === 'session/new') {
        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { sessionId: 'test-session-id' }
          }) + '\n'));
        }, 10);
      } else if (parsed.method === 'session/prompt') {
        // Simulate streaming
        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking...' } }
            }
          }) + '\n'));
        }, 20);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } }
            }
          }) + '\n'));
        }, 40);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world!' } }
            }
          }) + '\n'));
        }, 60);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { 
              stop_reason: 'end_turn',
              usage: {
                total_tokens: 150,
                prompt_tokens: 100,
                completion_tokens: 50
              }
            }
          }) + '\n'));
        }, 80);
      }
    });
    client = new AcpClient(mockAgent as any);
    sessionManager = new SessionManager(client);
  });

  it('should collect all chunks and return the full message', async () => {
    const messageBuffers = new Map<string, string>();
    const thoughtBuffers = new Map<string, string>();
    const pendingPermissions = new Map<string, any>();
    const activeTurnContexts = new Map<string, any>();
    
    client.on('notification:session/update', (params) => {
      if (params.update.sessionUpdate === 'agent_message_chunk') {
        const current = messageBuffers.get(params.sessionId) || '';
        messageBuffers.set(params.sessionId, current + (params.update.content?.text || ''));
      }
    });

    const mockAdapter: any = {
      constructor: { name: 'TestAdapter' },
      sendReply: vi.fn()
    };

    const commandHandler = new CommandHandler(
      client,
      sessionManager,
      [mockAdapter],
      messageBuffers,
      thoughtBuffers,
      pendingPermissions,
      activeTurnContexts
    );

    const context = {
      platform: 'test',
      channelId: 'c1',
      userId: 'u1',
      text: 'hi'
    };

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Hello world!')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('150/ 100/ 50 usage')
    );
  });
});
