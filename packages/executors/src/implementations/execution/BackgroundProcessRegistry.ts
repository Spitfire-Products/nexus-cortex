/**
 * Background Process Registry
 *
 * Simple in-memory registry to track background shell processes
 * spawned by ShellTool. Used by BashOutput and KillShell tools.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { stripAnsi } from '../../utils/TextUtils.js';

export interface BackgroundProcess {
  shellId: string;
  pid: number;
  command: string;
  startTime: Date;
  process?: ChildProcess;
  output: string[];
  exitCode: number | null;
  isRunning: boolean;
  /**
   * HB-HERDR-TERMINAL-BACKEND (R146): external handles (a herdr pane) have no child
   * process. `refresh` re-pulls `output`/`exitCode`/`isRunning` from the backend before
   * a BashOutput read; `onKill` is what KillShell invokes instead of a signal.
   */
  refresh?: () => Promise<void>;
  onKill?: () => Promise<void> | void;
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
        const lines = stripAnsi(data.toString()).split('\n').filter((l) => l.trim());
        bgProcess.output.push(...lines);
        this.emitter.emit('output', shellId, lines);
      });
    }

    if (process && process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const lines = stripAnsi(data.toString()).split('\n').filter((l) => l.trim());
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
   * Register an EXTERNAL handle (R146: a herdr pane) with no child process. BashOutput
   * calls `refresh` before reading; KillShell calls `onKill`. pid is 0 so the signal
   * paths in killProcess never fire for it.
   */
  registerExternal(
    shellId: string,
    command: string,
    hooks: { refresh: () => Promise<void>; onKill: () => Promise<void> | void },
  ): BackgroundProcess {
    const bgProcess: BackgroundProcess = {
      shellId,
      pid: 0,
      command,
      startTime: new Date(),
      output: [],
      exitCode: null,
      isRunning: true,
      refresh: hooks.refresh,
      onKill: hooks.onKill,
    };
    this.processes.set(shellId, bgProcess);
    return bgProcess;
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

    // R146: external handle (herdr pane) — the backend hook is the only kill path.
    if (process.onKill) {
      try {
        void process.onKill();
        process.isRunning = false;
        return true;
      } catch (error) {
        return false;
      }
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
    if (process.isRunning && process.pid > 0) {
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
