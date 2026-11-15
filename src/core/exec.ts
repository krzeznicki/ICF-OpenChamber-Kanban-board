// The real `Exec`: runs a program without a shell and never throws on a non-zero exit.
import { execFile } from 'node:child_process';
import type { Exec } from './types.ts';

const MAX_BUFFER = 64 * 1024 * 1024;

export const realExec: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, windowsHide: true, timeout: opts.timeoutMs ?? 0 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as { code?: unknown }).code;
        if (code === 'ENOENT') {
          resolve({ code: 127, stdout: '', stderr: `${cmd}: command not found` });
        } else if (typeof code === 'number') {
          resolve({ code, stdout, stderr });
        } else {
          // Killed by a signal, buffer overflow or a spawn error: report it as a failed run.
          resolve({ code: 1, stdout, stderr: stderr || error.message });
        }
      },
    );
  });
