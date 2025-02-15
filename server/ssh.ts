import { WebSocket, WebSocketServer } from 'ws';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';
import type { Express, Request, Response, NextFunction } from 'express';
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

// Create SSH credentials table with proper schema migration
db.serialize(() => {
  // First create the basic table if it doesn't exist
  db.run(`CREATE TABLE IF NOT EXISTS ssh_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_ip TEXT NOT NULL,
    username TEXT DEFAULT '',
    password_hash TEXT DEFAULT '',
    password TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    UNIQUE(client_ip)
  )`, (err) => {
    if (err) {
      console.error('Error creating ssh_credentials table:', err);
    } else {
      logger.info('SSH credentials table created or verified');
    }
  });

  // Add index for faster lookups if it doesn't exist
  db.run(`CREATE INDEX IF NOT EXISTS idx_ssh_credentials_client_ip ON ssh_credentials(client_ip)`, (err) => {
    if (err && !err.message.includes('already exists')) {
      console.error('Error creating index:', err);
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

// Modify SSH hostname registration function
export const registerSSHHostname = async (clientIp: string) => {
  try {
    logger.debug('Attempting to register SSH hostname for client:', clientIp);

    // First check if there is a connected client
    const clientExists = await new Promise<boolean>((resolve, reject) => {
      db.get(
        'SELECT hostname FROM monitored_clients WHERE (public_ip = ? OR client_ip = ?) AND status = ?',
        [clientIp, clientIp, 'online'],
        (err, row) => {
          if (err) {
            logger.error('Error checking client existence:', err);
            reject(err);
          } else {
            resolve(!!row);
          }
        }
      );
    });

    if (!clientExists) {
      logger.warn('Cannot register SSH for non-connected client:', clientIp);
      return false;
    }

    // Check if SSH credentials already exist
    const existing = await new Promise<any>((resolve, reject) => {
      db.get('SELECT id FROM ssh_credentials WHERE client_ip = ?', [clientIp], (err, row) => {
        if (err) {
          logger.error('Error checking existing SSH credentials:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!existing) {
      // Only insert new record if it doesn't exist
      await new Promise<void>((resolve, reject) => {
        db.run(
          `INSERT INTO ssh_credentials 
           (client_ip, username, password_hash, password, created_at, updated_at) 
           VALUES (?, '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [clientIp],
          function(err) {
            if (err) {
              logger.error('Error inserting SSH credentials:', err);
              reject(err);
            } else {
              logger.info('Successfully registered new SSH credentials for client:', clientIp);
              resolve();
            }
          }
        );
      });
      return true;
    }
    
    logger.debug('SSH credentials already exist for client:', clientIp);
    return true;
  } catch (err) {
    logger.error('Error in registerSSHHostname:', err);
    return false;
  }
};

// Modify save SSH credentials function
export const saveSSHCredentials = async (clientIp: string, username: string, password: string) => {
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO ssh_credentials 
         (client_ip, username, password_hash, password, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [clientIp, username, passwordHash, password],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    return true;
  } catch (err) {
    logger.error('Error saving SSH credentials:', err);
    return false;
  }
};

// Add internal request verification middleware
const verifyLocalRequest = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || req.socket.remoteAddress;
  const isLocalRequest = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
  
  if (!isLocalRequest) {
    logger.warn('Unauthorized access attempt to internal API:', {
      ip: clientIp,
      path: req.path
    });
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

export const setupSSHServer = (app: Express) => {
  // Get saved SSH credentials - add local validation middleware
  app.get('/api/ssh/credentials/:clientIp', verifyLocalRequest, async (req, res) => {
    const { clientIp } = req.params;
    
    try {
      // Check if client exists (without checking online status)
      const clientExists = await new Promise((resolve, reject) => {
        db.get(
          'SELECT hostname FROM monitored_clients WHERE (public_ip = ? OR client_ip = ?)',
          [clientIp, clientIp],
          (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
          }
        );
      });

      if (!clientExists) {
        return res.status(404).json({
          error: 'Client not found',
          code: 'CLIENT_NOT_FOUND'
        });
      }

      const credentials = await new Promise<any>((resolve, reject) => {
        db.get(
          'SELECT username, password FROM ssh_credentials WHERE client_ip = ?', 
          [clientIp], 
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (credentials && credentials.username) {
        // Update last used time
        await new Promise<void>((resolve, reject) => {
          db.run(
            'UPDATE ssh_credentials SET last_used = CURRENT_TIMESTAMP WHERE client_ip = ?',
            [clientIp],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        res.json(credentials);
      } else {
        // If no credentials found, return error
        res.status(404).json({ 
          error: 'No saved credentials found',
          code: 'NO_CREDENTIALS'
        });
      }
    } catch (err) {
      logger.error('Error retrieving SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Save SSH credentials - add local validation middleware
  app.post('/api/ssh/credentials', verifyLocalRequest, async (req, res) => {
    const { clientIp, username, password } = req.body;
    
    if (!clientIp || !username || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        code: 'INVALID_REQUEST'
      });
    }

    try {
      // First check if client exists and is online
      const clientExists = await new Promise((resolve, reject) => {
        db.get(
          'SELECT hostname FROM monitored_clients WHERE (public_ip = ? OR client_ip = ?) AND status = ?',
          [clientIp, clientIp, 'online'],
          (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
          }
        );
      });

      if (!clientExists) {
        return res.status(404).json({
          error: 'Client not found or not online',
          code: 'CLIENT_NOT_FOUND'
        });
      }

      // Save or update credentials
      const success = await saveSSHCredentials(clientIp, username, password);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ 
          error: 'Failed to save credentials',
          code: 'SAVE_FAILED'
        });
      }
    } catch (err) {
      logger.error('Error saving SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete SSH credentials - add local validation middleware
  app.delete('/api/ssh/credentials/:clientIp', verifyLocalRequest, async (req, res) => {
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

  // Verify SSH credentials endpoint
  app.post('/api/ssh/verify', async (req, res) => {
    const { hostname, username, password, isAutoLogin } = req.body;
    logger.debug('Verify request received:', { hostname, username, isAutoLogin });

    try {
      // Get saved credentials from database
      const savedCredentials = await new Promise<any>((resolve, reject) => {
        db.get(
          'SELECT username, password_hash, password FROM ssh_credentials WHERE client_ip = ?', 
          [hostname], 
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      logger.debug('Database query result:', { 
        hasSavedCredentials: !!savedCredentials,
        savedUsername: savedCredentials?.username
      });

      // If no saved credentials or username is empty, return error
      if (!savedCredentials || !savedCredentials.username) {
        logger.error('No SSH credentials set');
        return res.status(401).json({ 
          error: 'SSH credentials not set',
          code: 'NO_CREDENTIALS'
        });
      }

      let finalPassword = '';
      
      if (isAutoLogin) {
        // Auto login: must have saved credentials and username match
        if (savedCredentials.username !== username) {
          logger.error('Username mismatch for auto-login');
          return res.status(401).json({ 
            error: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS'
          });
        }
        finalPassword = savedCredentials.password;
        logger.debug('Using saved password for auto-login');
      } else {
        // Manual login: use provided password
        if (!password) {
          logger.error('Password is required for manual login');
          return res.status(400).json({ 
            error: 'Password is required',
            code: 'PASSWORD_REQUIRED'
          });
        }
        finalPassword = password;
      }

      logger.debug('Attempting SSH connection...', { 
        host: hostname,
        username,
        isAutoLogin
      });

      // Try SSH connection
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

        const ssh = new Client();
        ssh.on('ready', () => {
          logger.debug('SSH connection successful');
          ssh.end();
          resolve(true);
        }).on('error', async (err) => {
          logger.error('SSH connection error:', err);
          reject(new Error('Authentication failed. Please check your credentials.'));
        }).connect(sshConfig);
      });

      // Update last used time
      await new Promise<void>((resolve, reject) => {
        db.run(
          'UPDATE ssh_credentials SET last_used = CURRENT_TIMESTAMP WHERE client_ip = ?',
          [hostname],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // If connection successful, return original password for WebSocket use
      res.json({ 
        success: true,
        password: finalPassword
      });
    } catch (err: any) {
      logger.error('Error during SSH verification:', err);
      res.status(401).json({ 
        error: err.message || 'Authentication failed. Please check your credentials.',
        code: 'AUTH_FAILED'
      });
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

  // Get all SSH credentials - add local validation middleware
  app.get('/api/ssh/all-credentials', verifyLocalRequest, async (req, res) => {
    try {
      // Modify query to avoid duplicate records, without checking online status
      const credentials = await new Promise<any[]>((resolve, reject) => {
        db.all(
          `SELECT DISTINCT 
             mc.hostname,
             mc.status,
             mc.sort_order,
             mc.created_at,
             COALESCE(
               (SELECT client_ip FROM ssh_credentials 
                WHERE client_ip = mc.public_ip),
               (SELECT client_ip FROM ssh_credentials 
                WHERE client_ip = mc.client_ip),
               mc.public_ip,
               mc.client_ip
             ) as client_ip,
             (SELECT username FROM ssh_credentials 
              WHERE client_ip = mc.public_ip 
              OR client_ip = mc.client_ip 
              LIMIT 1) as username,
             (SELECT password FROM ssh_credentials 
              WHERE client_ip = mc.public_ip 
              OR client_ip = mc.client_ip 
              LIMIT 1) as password
           FROM monitored_clients mc
           WHERE mc.hostname IS NOT NULL
           AND (
             EXISTS (
               SELECT 1 FROM ssh_credentials sc 
               WHERE sc.client_ip = mc.public_ip 
               OR sc.client_ip = mc.client_ip
             )
           )
           ORDER BY mc.sort_order DESC, mc.created_at ASC`,
          [],
          (err, rows) => {
            if (err) {
              logger.error('Database query error:', err);
              reject(err);
            } else {
              resolve(rows);
            }
          }
        );
      });

      res.json(credentials);
    } catch (err) {
      logger.error('Error retrieving all SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Add endpoint to update SSH credentials
  app.put('/api/ssh/credentials/:clientIp', async (req, res) => {
    const { clientIp } = req.params;
    const { username, password } = req.body;
    
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      
      await new Promise<void>((resolve, reject) => {
        db.run(
          'UPDATE ssh_credentials SET username = ?, password_hash = ?, password = ? WHERE client_ip = ?',
          [username, passwordHash, password, clientIp],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error updating SSH credentials:', err);
      res.status(500).json({ error: 'Internal server error' });
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