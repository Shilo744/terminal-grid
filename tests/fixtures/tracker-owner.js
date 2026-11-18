'use strict';
// T58 fixture: a "test" that starts a helper process through the tracker and then either ends cleanly ("clean") or is hard-killed ("kill",
// like a test killed by the 15-minute timeout: no exit handler runs). Prints the helper's pid.
const { spawn } = require('child_process');
const tracker = require('../lib/tracker');

// detached = breaks away from libuv's kill-on-close job object. Without it Windows kills a node child when its parent dies, which hides the leak; a program started
// through the shell (a window, a dialog, an app) is outside that job and survives, so the helper has to as well.
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
helper.unref();
tracker.record(helper.pid, 'node.exe', 'unit helper');
console.log('HELPER ' + helper.pid);
setTimeout(() => {
  if (process.argv[2] === 'kill') process.kill(process.pid, 'SIGKILL'); // TerminateProcess: nothing is cleaned by the process itself
  else process.exit(0);           // normal end: the exit handler closes the helper
}, 400);
