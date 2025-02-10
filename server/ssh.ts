import { WebSocket, WebSocketServer } from 'ws';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';
import type { Express, Request } from 'express';
import { URL } from 'url';
import type { Socket } from 'net';
import type { Server } from 'http';
import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize database
const db = new sqlite3.Database(join(__dirname, 'monitor.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Create SSH credentials table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ssh_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_ip TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_ip)
  )`, (err) => {
    if (err) {
      console.error('Error creating ssh_credentials table:', err);
    }
  });
});

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
  // 获取保存的SSH凭证
  app.get('/api/ssh/credentials/:clientIp', async (req, res) => {
    const { clientIp } = req.params;
    
    try {
      const credentials = await new Promise<any>((resolve, reject) => {
        db.get('SELECT username, password FROM ssh_credentials WHERE client_ip = ?', [clientIp], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (credentials) {
        // 返回用户名和原始密码
        res.json({ 
          username: credentials.username,
          password: credentials.password // 返回原始密码用于SSH连接
        });
      } else {
        res.status(404).json({ error: 'No saved credentials found' });
      }
    } catch (err) {
      logger.error('Error retrieving SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 保存SSH凭证
  app.post('/api/ssh/credentials', async (req, res) => {
    const { clientIp, username, password } = req.body;
    
    try {
      // 保存原始密码和哈希
      const passwordHash = await bcrypt.hash(password, 10);
      
      await new Promise<void>((resolve, reject) => {
        db.run(
          'INSERT OR REPLACE INTO ssh_credentials (client_ip, username, password_hash, password) VALUES (?, ?, ?, ?)',
          [clientIp, username, passwordHash, password],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error saving SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 删除SSH凭证
  app.delete('/api/ssh/credentials/:clientIp', async (req, res) => {
    const { clientIp } = req.params;
    
    try {
      await new Promise<void>((resolve, reject) => {
        db.run('DELETE FROM ssh_credentials WHERE client_ip = ?', [clientIp], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error deleting SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 修改数据库表结构
  db.run(`ALTER TABLE ssh_credentials ADD COLUMN password TEXT`, (err) => {
    if (err && !err.message.includes('duplicate')) {
      console.error('Error adding password column:', err);
    }
  });

  // Verify SSH credentials endpoint
  app.post('/api/ssh/verify', async (req, res) => {
    const { hostname, username, password, isAutoLogin } = req.body;
    logger.debug('Verify request received:', { hostname, username, isAutoLogin });

    if (!username) {
      logger.error('Username is required');
      return res.status(400).json({ error: 'Username is required' });
    }

    const ssh = new Client();
    
    try {
      // 从数据库获取保存的凭证
      const savedCredentials = await new Promise<any>((resolve, reject) => {
        db.get('SELECT username, password_hash, password FROM ssh_credentials WHERE client_ip = ?', [hostname], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      logger.debug('Database query result:', { 
        hasSavedCredentials: !!savedCredentials,
        savedUsername: savedCredentials?.username
      });

      let finalPassword = '';
      
      if (isAutoLogin) {
        // 自动登录：必须有保存的凭证且用户名匹配
        if (!savedCredentials || savedCredentials.username !== username) {
          logger.error('No matching saved credentials found for auto-login');
          throw new Error('No matching saved credentials found');
        }
        // 使用保存的原始密码
        finalPassword = savedCredentials.password;
        logger.debug('Using saved password for auto-login');
      } else {
        // 手动登录：使用提供的密码
        if (!password) {
          logger.error('Password is required for manual login');
          throw new Error('Password is required');
        }
        finalPassword = password;
      }

      logger.debug('Attempting SSH connection...', { 
        host: hostname,
        username,
        isAutoLogin
      });

      // 尝试SSH连接
      await new Promise((resolve, reject) => {
        const sshConfig: ConnectConfig = {
          host: hostname,
          username,
          password: finalPassword,
          readyTimeout: 5000,
          debug: (msg: string) => logger.debug('SSH Debug:', msg),
          algorithms: {
            kex: [
              'curve25519-sha256@libssh.org',
              'ecdh-sha2-nistp256',
              'diffie-hellman-group14-sha256'
            ] as any,
            serverHostKey: [
              'ssh-rsa',
              'ecdsa-sha2-nistp256',
              'ssh-ed25519'
            ] as any,
            cipher: [
              'aes128-gcm@openssh.com',
              'aes256-gcm@openssh.com',
              'aes128-ctr'
            ] as any,
            hmac: [
              'hmac-sha2-256',
              'hmac-sha2-512'
            ] as any,
            compress: ['none'] as any
          }
        };

        ssh.on('ready', () => {
          logger.debug('SSH connection successful');
          ssh.end();
          resolve(true);
        }).on('error', async (err) => {
          logger.error('SSH connection error:', err);
          // 如果是自动登录失败，删除保存的凭证
          if (isAutoLogin) {
            try {
              await new Promise<void>((resolve, reject) => {
                db.run('DELETE FROM ssh_credentials WHERE client_ip = ?', [hostname], (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
              logger.debug('Removed invalid saved credentials');
            } catch (deleteErr) {
              logger.error('Error removing invalid credentials:', deleteErr);
            }
          }
          reject(err);
        }).connect(sshConfig);
      });

      // 如果连接成功，返回原始密码以供WebSocket使用
      res.json({ 
        success: true,
        password: finalPassword // 返回用于WebSocket连接的密码
      });
    } catch (err) {
      logger.error('SSH verification error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      // 如果验证失败，在响应中添加一个标志
      res.status(401).json({ 
        error: errorMessage,
        credentialsCleared: isAutoLogin // 告诉客户端凭证已被清除
      });
    } finally {
      if (ssh) {
        ssh.end();
      }
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