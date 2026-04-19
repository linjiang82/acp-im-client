import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpClient } from '../agent/acpClient.js';
import { AgentProcess } from '../agent/process.js';
import { EventEmitter } from 'events';

describe('AcpClient', () => {
  let mockAgent: any;
  let client: AcpClient;

  beforeEach(() => {
    mockAgent = new EventEmitter();
    mockAgent.send = vi.fn();
    client = new AcpClient(mockAgent as any);
  });

  it('should parse agent_message_chunk notifications', async () => {
    const notificationPromise = new Promise<any>((resolve) => {
      client.on('notification:session/update', (params) => {
        resolve(params);
      });
    });

    const mockMessage = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'test-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' }
        }
      }
    });

    mockAgent.emit('stdout', Buffer.from(mockMessage + '\n'));

    const params = await notificationPromise;
    expect(params.sessionId).toBe('test-session');
    expect(params.update.sessionUpdate).toBe('agent_message_chunk');
    expect(params.update.content.text).toBe('Hello');
  });

  it('should parse agent_thought_chunk notifications', async () => {
    const notificationPromise = new Promise<any>((resolve) => {
      client.on('notification:session/update', (params) => {
        resolve(params);
      });
    });

    const mockMessage = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'test-session',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking...' }
        }
      }
    });

    mockAgent.emit('stdout', Buffer.from(mockMessage + '\n'));

    const params = await notificationPromise;
    expect(params.update.sessionUpdate).toBe('agent_thought_chunk');
    expect(params.update.content.text).toBe('Thinking...');
  });

  it('should handle multiple lines in one buffer', async () => {
    const updates: any[] = [];
    client.on('notification:session/update', (params) => {
      updates.push(params);
    });

    const line1 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', delta: 'H' } }
    });
    const line2 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', delta: 'e' } }
    });

    mockAgent.emit('stdout', Buffer.from(line1 + '\n' + line2 + '\n'));

    expect(updates).toHaveLength(2);
    expect(updates[0].update.delta).toBe('H');
    expect(updates[1].update.delta).toBe('e');
  });

  it('should parse JSON even with prefix text in a line', async () => {
    const notificationPromise = new Promise<any>((resolve) => {
      client.on('notification:test', (params) => resolve(params));
    });

    const messyLine = '[WARN] 2026-04-15 Some noisy log {"jsonrpc": "2.0", "method": "test", "params": {"foo": "bar"}} extra garbage';
    mockAgent.emit('stdout', Buffer.from(messyLine + '\n'));

    const params = await notificationPromise;
    expect(params.foo).toBe('bar');
  });

  it('should handle inbound requests from the agent', async () => {
    const requestPromise = new Promise<any>((resolve) => {
      client.on('request:session/request_permission', (req) => resolve(req));
    });

    const mockRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 'agent-req-1',
      method: 'session/request_permission',
      params: { sessionId: 's1', permission: { description: 'test' } }
    });

    mockAgent.emit('stdout', Buffer.from(mockRequest + '\n'));

    const req = await requestPromise;
    expect(req.id).toBe('agent-req-1');
    expect(req.method).toBe('session/request_permission');

    // Test responding with the actual nested outcome structure
    client.respond(req.id, { 
      outcome: {
        outcome: 'selected',
        optionId: 'opt-allow'
      }
    });
    expect(mockAgent.send).toHaveBeenCalledWith(JSON.stringify({
      jsonrpc: '2.0',
      id: 'agent-req-1',
      result: { 
        outcome: {
          outcome: 'selected',
          optionId: 'opt-allow'
        }
      }
    }));
  });

  it('should handle allow_always permission response', async () => {
    const requestPromise = new Promise<any>((resolve) => {
      client.on('request:session/request_permission', (req) => resolve(req));
    });

    const mockRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 'agent-req-2',
      method: 'session/request_permission',
      params: { sessionId: 's1', options: [{ kind: 'allow_always', optionId: 'opt-always' }] }
    });

    mockAgent.emit('stdout', Buffer.from(mockRequest + '\n'));

    const req = await requestPromise;
    client.respond(req.id, { 
      outcome: {
        outcome: 'selected',
        optionId: 'opt-always'
      }
    });
    expect(mockAgent.send).toHaveBeenCalledWith(JSON.stringify({
      jsonrpc: '2.0',
      id: 'agent-req-2',
      result: { 
        outcome: {
          outcome: 'selected',
          optionId: 'opt-always'
        }
      }
    }));
  });
});
