// /api/terminals/:id: one PTY per WebSocket running `tmux attach`, so several clients can watch one session.
import type { Server } from 'node:http';
import { spawn } from 'node-pty';
import { WebSocketServer } from 'ws';
import type { TerminalControl } from '../../shared/api.ts';
import { keepAlive, onUpgrade } from '../api/upgrade.ts';
import { tmuxName, type SessionsService } from './service.ts';

const size = (value: string | null, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
};

/** `tmux attach` argv. A `follow` client (the phone) never sizes the shared window: ignore-size, so the desktop keeps its layout. */
export function attachArgs(socket: string, name: string, follow: boolean): string[] {
  return ['-L', socket, 'attach-session', ...(follow ? ['-f', 'ignore-size'] : []), '-t', `=${name}`];
}

export const parseFollow = (query: URLSearchParams): boolean => query.get('follow') === '1';

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
    const follow = parseFollow(query);
    // Reconnects ask for a seed: the recent output first, so the client's scrollback is not blank while tmux repaints.
    const seed = query.get('seed') === '1';
    const windowSize = () => {
      const [cols, rows] = sessions.tmux
        .run(['display-message', '-p', '-t', `=${tmuxName(id)}:`, '#{window_width} #{window_height}'])
        .trim()
        .split(' ')
        .map(Number);
      return { cols: size(String(cols), 120), rows: size(String(rows), 32) };
    };
    const asked = { cols: size(query.get('cols'), 120), rows: size(query.get('rows'), 32) };
    wss.handleUpgrade(req, socket, head, (ws) => {
      keepAlive(ws);
      let start = asked;
      if (follow) {
        try {
          start = windowSize();
        } catch {
          // session died since has(): attach below fails and closes the socket
        }
      }
      const sizeMsg = (c: number, r: number) =>
        '\u0000' + JSON.stringify({ type: 'size', cols: c, rows: r } satisfies TerminalControl);
      // The follower's xterm must have the window's size before tmux paints or the seed arrives.
      if (follow) ws.send(sizeMsg(start.cols, start.rows));
      if (seed) {
        try {
          const text = sessions.tmux.run(['capture-pane', '-p', '-e', '-S', '-2000', '-t', `=${tmuxName(id)}:`]);
          ws.send(Buffer.from(text.trimEnd().replaceAll('\n', '\r\n') + '\r\n', 'utf8'));
        } catch {
          // no seed, tmux repaints anyway
        }
      }
      const pty = spawn('tmux', attachArgs(sessions.tmux.socket, tmuxName(id), follow), {
        name: 'xterm-256color',
        ...start,
        cwd: session.cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
      pty.onData((data) => ws.readyState === ws.OPEN && ws.send(Buffer.from(data, 'utf8')));
      pty.onExit(() => ws.close());
      // A follower is told the window's size (and mirrors it in its xterm) instead of sizing it; the desktop may resize later.
      if (follow) {
        let last = `${start.cols}x${start.rows}`;
        const track = setInterval(() => {
          try {
            const { cols, rows } = windowSize();
            if (`${cols}x${rows}` === last) return;
            last = `${cols}x${rows}`;
            pty.resize(cols, rows);
            ws.send(sizeMsg(cols, rows));
          } catch {
            // session gone: the pty exit closes the socket
          }
        }, 1000);
        ws.on('close', () => clearInterval(track));
      }
      // Phones below control watch only: their keystrokes are dropped, resizes still apply.
      const typing = !caller.level || caller.level === 'control';
      ws.on('message', (data, isBinary) => {
        inbound((data as Buffer).toString('utf8'), isBinary, { follow, typing }, pty); // default binaryType 'nodebuffer'
      });
      ws.on('close', () => pty.kill());
    });
  });
}

/** One client message: control frames resize (a follower never does), everything else is typed unless the caller only watches. */
export function inbound(
  text: string,
  isBinary: boolean,
  mode: { follow: boolean; typing: boolean },
  pty: { resize(cols: number, rows: number): void; write(data: string): void },
): void {
  if (!isBinary && text.startsWith('\u0000')) {
    if (!mode.follow) control(text.slice(1), pty);
  } else if (mode.typing) pty.write(text);
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
