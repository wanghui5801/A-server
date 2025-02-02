import { WebSocket, WebSocketServer } from 'ws';
import { Client } from 'ssh2';
import type { Express, Request } from 'express';
import { URL } from 'url';
import type { Socket } from 'net';
import type { Server } from 'http';

// Add log level configuration
const LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'error' : 'debug';

// Add logging utility
const logger = {
  error: (...args: any[]) => {
    console.error(...args);
  },
  warn: (...args: any[]) => {
    if (LOG_LEVEL !== 'error') {
      console.warn(...args);
    }
  },
  info: (...args: any[]) => {
    if (LOG_LEVEL === 'debug') {
      console.log(...args);
    }
  },
  debug: (...args: any[]) => {
    if (LOG_LEVEL === 'debug') {
      console.log('[DEBUG]', ...args);
    }
  }
};

interface SSHConfig {
  hostname: string;
  username: string;
  password: string;
}

export const setupSSHServer = (app: Express) => {
  // Verify SSH credentials endpoint
  app.post('/api/ssh/verify', async (req, res) => {
    const { hostname, username, password } = req.body;

    const ssh = new Client();
    
    try {
      await new Promise((resolve, reject) => {
        ssh.on('ready', () => {
          ssh.end();
          resolve(true);
        }).on('error', (err) => {
          reject(err);
        }).connect({
          host: hostname,
          username,
          password,
          readyTimeout: 5000,
          // Add more SSH options for better compatibility
          algorithms: {
            kex: [
              'curve25519-sha256@libssh.org',
              'ecdh-sha2-nistp256',
              'diffie-hellman-group14-sha256'
            ],
            serverHostKey: [
              'ssh-rsa',
              'ecdsa-sha2-nistp256',
              'ssh-ed25519'
            ],
            cipher: [
              'aes128-gcm@openssh.com',
              'aes256-gcm@openssh.com',
              'aes128-ctr'
            ],
            hmac: [
              'hmac-sha2-256',
              'hmac-sha2-512'
            ],
            compress: ['none']
          }
        });
      });

      res.json({ success: true });
    } catch (err) {
      res.status(401).json({ error: 'Authentication failed' });
    }
  });

  // WebSocket endpoint for SSH connections
  const wss = new WebSocketServer({ noServer: true });

  // Get the HTTP server instance from the Express app
  const server = app.get('server') as Server;
  if (!server) {
    logger.error('HTTP server not found in Express app');
    throw new Error('HTTP server not found in Express app');
  }

  server.on('upgrade', (request: Request, socket: Socket, head: Buffer) => {
    const urlString = `http://${request.headers.host}${request.url}`;
    const { pathname, searchParams } = new URL(urlString);

    // Handle both development and production paths
    if (pathname === '/ssh' || pathname === '/api/ssh') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const sshConfig: SSHConfig = {
          hostname: searchParams.get('hostname')!,
          username: searchParams.get('username')!,
          password: searchParams.get('password')!,
        };

        logger.debug('SSH connection attempt:', {
          hostname: sshConfig.hostname,
          username: sshConfig.username,
          path: pathname
        });

        handleSSHConnection(ws, sshConfig);
      });
    }
  });
};

const handleSSHConnection = (ws: WebSocket, config: SSHConfig) => {
  const ssh = new Client();
  let stream: any;

  ssh.on('ready', () => {
    // Use larger default terminal size
    const defaultRows = 30;
    const defaultCols = 120;
    
    ssh.shell({
      term: 'xterm-256color',
      rows: defaultRows,
      cols: defaultCols,
      modes: {
        ECHO: 1,
        ICANON: 1
      }
    }, (err, shellStream) => {
      if (err) {
        logger.error('SSH shell error:', err);
        ws.send(`\r\nSSH shell error: ${err.message}`);
        ws.close();
        return;
      }

      stream = shellStream;

      // Set initial window size
      stream.setWindow(defaultRows, defaultCols);

      stream.on('data', (data: Buffer) => {
        try {
          ws.send(data.toString('utf-8'));
        } catch (err) {
          logger.error('WebSocket send error:', err);
        }
      });

      stream.stderr.on('data', (data: Buffer) => {
        try {
          ws.send(data.toString('utf-8'));
        } catch (err) {
          logger.error('WebSocket stderr send error:', err);
        }
      });

      stream.on('close', () => {
        logger.debug('SSH stream closed');
        ws.close();
      });

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'data') {
            stream.write(message.data);
          } else if (message.type === 'resize' && message.rows && message.cols) {
            // Validate terminal size and ensure minimum dimensions
            const rows = Math.max(24, Math.min(500, parseInt(message.rows)));
            const cols = Math.max(80, Math.min(500, parseInt(message.cols)));
            
            if (!isNaN(rows) && !isNaN(cols)) {
              stream.setWindow(rows, cols);
              logger.debug('Terminal resized to:', { rows, cols });
            }
          }
        } catch (err) {
          logger.error('Error processing WebSocket message:', err);
        }
      });

      ws.on('close', () => {
        logger.debug('WebSocket connection closed');
        stream.end();
        ssh.end();
      });
    });
  });

  ssh.on('error', (err) => {
    logger.error('SSH connection error:', err);
    ws.send(`\r\nSSH connection error: ${err.message}`);
    ws.close();
  });

  // Optimize SSH connection configuration
  ssh.connect({
    host: config.hostname,
    username: config.username,
    password: config.password,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    debug: (msg: string) => logger.debug('SSH Debug:', msg),
    algorithms: {
      kex: [
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'diffie-hellman-group14-sha256'
      ],
      serverHostKey: [
        'ssh-rsa',
        'ecdsa-sha2-nistp256',
        'ssh-ed25519'
      ],
      cipher: [
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr'
      ],
      hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512'
      ],
      compress: ['none']
    }
  });
}; 