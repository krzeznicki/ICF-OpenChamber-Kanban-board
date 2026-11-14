// Entry of the built `build/cli/task-board.mjs`: runs `main` with the process's own streams.
import { main } from './main.ts';

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  stdin: process.stdin,
  cwd: process.cwd(),
});
