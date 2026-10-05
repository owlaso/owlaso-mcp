// Loaded into the spawned OwlASO server via `node --import`. Reports the port the server
// actually bound (it is started with PORT=0) over IPC, so the parent never has to reserve a
// port and release it again (a window in which another local process could take it).
import net from 'node:net';

const listen = net.Server.prototype.listen;
let reported = false;

net.Server.prototype.listen = function patchedListen(...args) {
  if (!reported) {
    this.once('listening', () => {
      const addr = this.address();
      if (reported || !addr || typeof addr !== 'object') return;
      reported = true;
      process.send?.({ owlasoPort: addr.port });
    });
  }
  return listen.apply(this, args);
};

// Parent gone (even SIGKILL): don't linger as an orphan.
process.on('disconnect', () => process.exit(0));
