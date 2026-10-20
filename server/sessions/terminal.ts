// /api/terminals/:id: one PTY per WebSocket running `tmux attach`, so several clients can watch one session.
import type { Server } from 'node:http';
import { spawn } from 'node-pty';
import { WebSocketServer } from 'ws';
import type { TerminalControl } from '../../shared/api.ts';
import { onUpgrade } from '../api/upgrade.ts';
import { tmuxName, type SessionsService } from './service.ts';

const size = (value: string | null, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
};

export function attachTerminals(server: Server, sessions: SessionsService): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('close', () => wss.close());
  onUpgrade(server, /^\/api\/terminals\/([^/]+)$/, (req, socket, head, caller, match) => {
    // A terminal can type anything, so only the user (browser or CLI with the access token) attaches.
    if (caller.kind !== 'user' && caller.kind !== 'cli') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const id = decodeURIComponent(match[1]);
    const session = sessions.get(id);
    if (!session || session.status === 'exited' || !sessions.tmux.has(tmuxName(id))) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const query = new URL(req.url ?? '/', 'http://x').searchParams;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const pty = spawn('tmux', ['-L', sessions.tmux.socket, 'attach-session', '-t', `=${tmuxName(id)}`], {
        name: 'xterm-256color',
        cols: size(query.get('cols'), 120),
        rows: size(query.get('rows'), 32),
        cwd: session.cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
      pty.onData((data) => ws.readyState === ws.OPEN && ws.send(Buffer.from(data, 'utf8')));
      pty.onExit(() => ws.close());
      // Phones below control watch only: their keystrokes are dropped, resizes still apply.
      const typing = !caller.level || caller.level === 'control';
      ws.on('message', (data, isBinary) => {
        const text = (data as Buffer).toString('utf8'); // default binaryType 'nodebuffer'
        if (!isBinary && text.startsWith('\u0000')) return control(text.slice(1), pty);
        if (typing) pty.write(text);
      });
      ws.on('close', () => pty.kill());
    });
  });
}

function control(json: string, pty: { resize(cols: number, rows: number): void }): void {
  let msg: TerminalControl;
  try {
    msg = JSON.parse(json);
  } catch {
    return;
  }
  if (msg.type === 'resize') pty.resize(size(String(msg.cols), 120), size(String(msg.rows), 32));
}
