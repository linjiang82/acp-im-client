import { spawn, ChildProcess } from 'child_process';
import { pino } from 'pino';
import { EventEmitter } from 'events';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class AgentProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private geminiPath: string;

  constructor(geminiPath = 'gemini') {
    super();
    this.geminiPath = geminiPath;
  }

  public start(): void {
    if (this.process) {
      logger.warn('Agent process is already running');
      return;
    }

    logger.info(`Starting agent process: ${this.geminiPath} --acp`);
    this.process = spawn(this.geminiPath, ['--acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.emit('stdout', data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString();
      logger.error(`Agent stderr: ${message}`);
      this.emit('stderr', message);
    });

    this.process.on('close', (code) => {
      logger.info(`Agent process closed with code ${code}`);
      this.process = null;
      this.emit('close', code);
    });

    this.process.on('error', (err) => {
      logger.error(`Agent process error: ${err.message}`);
      this.emit('error', err);
    });
  }

  public send(message: string): void {
    if (!this.process || !this.process.stdin) {
      logger.error('Cannot send message: agent process is not running');
      return;
    }
    this.process.stdin.write(message + '\n');
  }

  public stop(): void {
    if (this.process) {
      logger.info('Stopping agent process');
      this.process.kill();
      this.process = null;
    }
  }

  public getPid(): number | undefined {
    return this.process?.pid;
  }

  public isRunning(): boolean {
    return this.process !== null;
  }
}
