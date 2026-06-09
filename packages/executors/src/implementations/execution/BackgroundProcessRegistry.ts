/**
 * Background Process Registry
 *
 * Simple in-memory registry to track background shell processes
 * spawned by ShellTool. Used by BashOutput and KillShell tools.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface BackgroundProcess {
  shellId: string;
  pid: number;
  command: string;
  startTime: Date;
  process?: ChildProcess;
  output: string[];
  exitCode: number | null;
  isRunning: boolean;
}

/**
 * Singleton registry for background processes
 */
export class BackgroundProcessRegistry {
  private static instance: BackgroundProcessRegistry;
  private processes: Map<string, BackgroundProcess> = new Map();
  private emitter: EventEmitter = new EventEmitter();

  private constructor() {}

  static getInstance(): BackgroundProcessRegistry {
    if (!BackgroundProcessRegistry.instance) {
      BackgroundProcessRegistry.instance = new BackgroundProcessRegistry();
    }
    return BackgroundProcessRegistry.instance;
  }

  /**
   * Register a background process
   */
  registerProcess(shellId: string, pid: number, command: string, process?: ChildProcess): void {
    const bgProcess: BackgroundProcess = {
      shellId,
      pid,
      command,
      startTime: new Date(),
      process,
      output: [],
      exitCode: null,
      isRunning: true,
    };

    this.processes.set(shellId, bgProcess);

    // Monitor process output if available
    if (process && process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim());
        bgProcess.output.push(...lines);
        this.emitter.emit('output', shellId, lines);
      });
    }

    if (process && process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim());
        bgProcess.output.push(...lines);
        this.emitter.emit('output', shellId, lines);
      });
    }

    // Monitor process exit
    if (process) {
      process.on('exit', (code) => {
        bgProcess.exitCode = code;
        bgProcess.isRunning = false;
        this.emitter.emit('exit', shellId, code);
      });
    }
  }

  /**
   * Get a background process by shell ID
   */
  getProcess(shellId: string): BackgroundProcess | undefined {
    return this.processes.get(shellId);
  }

  /**
   * Get all background processes
   */
  getAllProcesses(): BackgroundProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get output for a process
   */
  getOutput(shellId: string, fromLine: number = 0): string[] {
    const process = this.processes.get(shellId);
    if (!process) {
      return [];
    }
    return process.output.slice(fromLine);
  }

  /**
   * Kill a background process
   */
  killProcess(shellId: string): boolean {
    const process = this.processes.get(shellId);
    if (!process) {
      return false;
    }

    if (process.process && process.isRunning) {
      try {
        process.process.kill('SIGTERM');
        process.isRunning = false;
        return true;
      } catch (error) {
        return false;
      }
    }

    // If no process handle, try to kill by PID directly using Node.js process API
    if (process.isRunning && process.pid) {
      try {
        // Use Node.js global process.kill()
        global.process.kill(process.pid, 'SIGTERM');
        process.isRunning = false;
        return true;
      } catch (error) {
        return false;
      }
    }

    return false;
  }

  /**
   * Remove a process from the registry
   */
  removeProcess(shellId: string): boolean {
    return this.processes.delete(shellId);
  }

  /**
   * Clear all processes (for testing)
   */
  clear(): void {
    this.processes.clear();
  }

  /**
   * Check if a process exists
   */
  hasProcess(shellId: string): boolean {
    return this.processes.has(shellId);
  }

  /**
   * Get process count
   */
  getProcessCount(): number {
    return this.processes.size;
  }

  /**
   * Subscribe to process events
   */
  on(event: 'output' | 'exit', callback: (...args: any[]) => void): void {
    this.emitter.on(event, callback);
  }
}
