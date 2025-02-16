import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { Client } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import bcrypt from 'bcrypt';
import { setupSSHServer, registerSSHHostname } from './ssh';
import jwt from 'jsonwebtoken';

// Add type definitions
interface JwtPayload {
  isAdmin: boolean;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_EXPIRY = '24h';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Configure CORS - Updated for more permissive settings
app.use(cors({
  origin: true, // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Request', 'X-Auth-Token'],
  credentials: true,
  maxAge: 86400
}));

app.use(express.json());

const httpServer = createServer(app);

// Store the HTTP server in the Express app
app.set('server', httpServer);

// Set up SSH server
setupSSHServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: true, // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true
  },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 10000,
  allowEIO3: true
});

// Store hostname to socket ID mapping
const hostnameToSocketId = new Map<string, string>();

// Add log level configuration at the top of the file
const LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'error' : 'debug';

// Add cleanup interval configuration at the top of the file after LOG_LEVEL
const CLEANUP_INTERVAL = 3600000; // Run cleanup every hour
const PING_HISTORY_RETENTION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_CLIENTS_HISTORY = 100; // Maximum number of historical records per client

// Add IP geolocation cache configuration
const IP_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const IP_CACHE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Clean up every 24 hours

// Cache interface
interface IPCacheEntry {
  countryCode: string;
  timestamp: number;
}

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

// Initialize database
const db = new sqlite3.Database(join(__dirname, 'monitor.db'), (err) => {
  if (err) {
    logger.error('Error opening database:', err);
    process.exit(1);
  }
  logger.info('Connected to database');
});

// Create IP cache table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ip_cache (
    ip TEXT PRIMARY KEY,
    country_code TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`, (err) => {
    if (err) {
      logger.error('Error creating IP cache table:', err);
    } else {
      logger.info('IP cache table ready');
    }
  });
});

// Add function to clean up old IP cache entries
async function cleanupIPCache() {
  const expiryTime = Date.now() - IP_CACHE_DURATION;
  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM ip_cache WHERE timestamp < ?', [expiryTime], (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });
    logger.debug('Cleaned up old IP cache entries');
  } catch (error) {
    logger.error('Error cleaning up IP cache:', error);
  }
}

// Schedule regular cleanup
setInterval(cleanupIPCache, IP_CACHE_CLEANUP_INTERVAL);

// Add database cleanup function after db initialization
function setupDatabaseCleanup() {
  // Periodic cleanup function
  const cleanupDatabase = async () => {
    try {
      const oneDayAgo = Date.now() - PING_HISTORY_RETENTION;
      
      // Clean up old ping history
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM ping_history WHERE timestamp < ?', [oneDayAgo], (err) => {
          if (err) {
            logger.error('Error cleaning ping history:', err);
            reject(err);
          } else {
            resolve(null);
          }
        });
      });

      // Clean up old client history while keeping the most recent records
      await new Promise((resolve, reject) => {
        db.run(`
          DELETE FROM clients 
          WHERE id IN (
            SELECT id FROM (
              SELECT id, 
                     ROW_NUMBER() OVER (PARTITION BY hostname ORDER BY lastSeen DESC) as rn 
              FROM clients
              WHERE status = 'last_seen'
            ) ranked 
            WHERE rn > ?
          )`, [MAX_CLIENTS_HISTORY], (err) => {
          if (err) {
            logger.error('Error cleaning client history:', err);
            reject(err);
          } else {
            resolve(null);
          }
        });
      });

      // Optimize database
      await new Promise((resolve, reject) => {
        db.run('VACUUM', (err) => {
          if (err) {
            logger.error('Error optimizing database:', err);
            reject(err);
          } else {
            resolve(null);
          }
        });
      });

      logger.info('Database cleanup completed successfully');
    } catch (error) {
      logger.error('Error during database cleanup:', error);
    }
  };

  // Run cleanup immediately on startup
  cleanupDatabase();
  
  // Schedule periodic cleanup
  setInterval(cleanupDatabase, CLEANUP_INTERVAL);
}

// Call setupDatabaseCleanup after database initialization
db.serialize(() => {
  // Create server_info table for caching server information
  db.run(`CREATE TABLE IF NOT EXISTS server_info (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  )`, (err) => {
    if (err) {
      logger.error('Error creating server_info table:', err);
    } else {
      logger.info('Server info table ready');
    }
  });

  // First, check if we need to add the public_ip column to monitored_clients
  db.run(`ALTER TABLE monitored_clients ADD COLUMN public_ip TEXT`, (err) => {
    // Ignore error if column already exists
    logger.debug('Checked monitored_clients public_ip column');
  });

  db.run(`ALTER TABLE monitored_clients ADD COLUMN client_ip TEXT`, (err) => {
    // Ignore error if column already exists
    logger.debug('Checked monitored_clients client_ip column');
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS monitored_clients (
    hostname TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sort_order INTEGER DEFAULT 0,
    public_ip TEXT,
    client_ip TEXT,
    country_code TEXT,
    last_seen DATETIME,
    UNIQUE(hostname)
  )`, (err) => {
    if (err) {
      logger.error('Error creating monitored_clients table:', err);
    } else {
      logger.info('Monitored clients table ready');
    }
  });

  // Add index for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_monitored_clients_ip ON monitored_clients(public_ip, client_ip)`, (err) => {
    if (err && !err.message.includes('already exists')) {
      logger.error('Error creating monitored_clients index:', err);
    }
  });

  // First, check if we need to add the public_ip column to clients
  db.run(`ALTER TABLE clients ADD COLUMN public_ip TEXT`, (err) => {
    // Ignore error if column already exists
    logger.debug('Checked clients public_ip column');
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    hostname TEXT,
    ip TEXT,
    public_ip TEXT,
    country_code TEXT,
    lastSeen TEXT,
    cpuModel TEXT,
    cpuThreads INTEGER,
    cpuUsage REAL,
    memoryUsage REAL,
    diskUsage REAL,
    memoryTotal INTEGER,
    diskTotal INTEGER,
    uptime INTEGER,
    networkRx TEXT,
    networkTx TEXT,
    status TEXT,
    pingLatency REAL,
    pingTimestamp INTEGER,
    ping_data TEXT
  )`, (err) => {
    if (err) {
      logger.error('Error creating clients table:', err);
    } else {
      logger.info('Clients table ready');
    }
  });
  
  // Modify ping config table
  db.run(`CREATE TABLE IF NOT EXISTS ping_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    port INTEGER DEFAULT 80,
    interval INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating ping_config table:', err);
    } else {
      console.log('Ping config table ready');
    }
  });

  // Add ping_history table
  db.run(`
    CREATE TABLE IF NOT EXISTS ping_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      hostname TEXT,
      latency REAL,
      target TEXT,
      port INTEGER,
      timestamp INTEGER,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `);

  // Add admin password table
  db.run(`CREATE TABLE IF NOT EXISTS admin_password (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating admin_password table:', err);
    } else {
      console.log('Admin password table ready');
    }
  });

  // Create client_tags table
  db.run(`
    CREATE TABLE IF NOT EXISTS client_tags (
      hostname TEXT,
      tag TEXT,
      PRIMARY KEY (hostname, tag),
      FOREIGN KEY (hostname) REFERENCES monitored_clients(hostname) ON DELETE CASCADE
    )
  `);

  // Add this at the end of the serialize block
  setupDatabaseCleanup();
});

// Clean up old connections
db.run('DELETE FROM clients', (err) => {
  if (err) {
    logger.error('Error cleaning old connections:', err);
  } else {
    logger.info('Cleaned old connections');
  }
});

// Add ping management functionality
const PING_TARGET = '8.8.8.8';
const PING_INTERVAL = 10000; // 10 seconds

async function updatePingData(clientId: string, latency: number) {
  const timestamp = Date.now();
  await db.run(
    'UPDATE clients SET pingLatency = ?, pingTimestamp = ? WHERE id = ?',
    [latency, timestamp, clientId]
  );
}

// Add type definitions
interface DbRow {
  hostname: string;
  [key: string]: any;
}

interface ClientRow {
  hostname: string;
  [key: string]: any;
}

interface LastOnlineData {
  ip: string | null;
  lastSeen: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  cpuModel: string | null;
  uptime: number;
  networkRx: string;
  networkTx: string;
}

interface LastData {
  ip?: string | null;
  lastSeen?: string | null;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  cpuModel?: string | null;
  uptime?: number;
  networkRx?: string;
  networkTx?: string;
}

// Modify network traffic formatting function
function formatNetworkTraffic(value: string): string {
  if (!value || value === 'Unknown') return 'Unknown';
  
  // If value already contains units (B, KB, MB, GB, TB), return as is
  if (/^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$/.test(value)) {
    return value;
  }
  
  // Only format if value is a pure number
  try {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    
    if (num >= 1024 * 1024 * 1024) {
      return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (num >= 1024 * 1024) {
      return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    } else if (num >= 1024) {
      return `${(num / 1024).toFixed(2)} KB`;
    } else {
      return `${num.toFixed(2)} B`;
    }
  } catch (e) {
    return value;
  }
}

// Add function to get public IP
async function getPublicIP(socket: any): Promise<string | null> {
  try {
    // Helper function to clean IP address
    const cleanIPAddress = (ip: string): string => {
      // Remove IPv6 prefix if present
      if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
      }
      // Remove port number if present
      if (ip.includes(':')) {
        ip = ip.split(':')[0];
      }
      return ip;
    };

    // Try x-forwarded-for header first
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = forwardedFor.split(',').map((ip: string) => cleanIPAddress(ip.trim()));
      const clientIP = ips[0];
      if (clientIP && clientIP !== '::1' && clientIP !== '127.0.0.1') {
        logger.debug('Got client IP from x-forwarded-for:', clientIP);
        return clientIP;
      }
    }

    // Try x-real-ip header
    const realIP = socket.handshake.headers['x-real-ip'];
    if (realIP) {
      const cleanedIP = cleanIPAddress(realIP);
      if (cleanedIP && cleanedIP !== '::1' && cleanedIP !== '127.0.0.1') {
        logger.debug('Got client IP from x-real-ip:', cleanedIP);
        return cleanedIP;
      }
    }

    // Try socket remote address
    const remoteAddress = socket.handshake.address;
    if (remoteAddress) {
      const cleanedIP = cleanIPAddress(remoteAddress);
      if (cleanedIP && cleanedIP !== '::1' && cleanedIP !== '127.0.0.1') {
        logger.debug('Got client IP from socket remote address:', cleanedIP);
        return cleanedIP;
      }
    }

    // Try socket connection remote address
    const connRemoteAddress = socket.conn?.remoteAddress || socket.request?.connection?.remoteAddress;
    if (connRemoteAddress) {
      const cleanedIP = cleanIPAddress(connRemoteAddress);
      if (cleanedIP && cleanedIP !== '::1' && cleanedIP !== '127.0.0.1') {
        logger.debug('Got client IP from socket connection:', cleanedIP);
        return cleanedIP;
      }
    }

    logger.error('Failed to get client IP from any source');
    return null;
  } catch (error) {
    logger.error('Error getting client IP:', error);
    return null;
  }
}

// Add function to get country code
async function getCountryCode(ip: string): Promise<string | null> {
  try {
    logger.debug('Getting country code for IP:', ip);
    
    // Check cache first
    const cachedResult = await new Promise<IPCacheEntry | null>((resolve, reject) => {
      db.get('SELECT country_code, timestamp FROM ip_cache WHERE ip = ?', [ip], (err, row: any) => {
        if (err) reject(err);
        else resolve(row ? { countryCode: row.country_code, timestamp: row.timestamp } : null);
      });
    });

    // If we have a valid cached result that hasn't expired
    if (cachedResult && (Date.now() - cachedResult.timestamp) < IP_CACHE_DURATION) {
      logger.debug('Using cached country code:', cachedResult.countryCode);
      return cachedResult.countryCode;
    }

    // If cache miss or expired, try API services
    let countryCode: string | null = null;
    
    // Try primary IP API service
    try {
      const response = await fetch(`https://ipapi.co/${ip}/country`);
      if (response.ok) {
        const country = await response.text();
        if (country && country.length === 2) {
          countryCode = country.toLowerCase();
          logger.debug('Resolved country code from primary service:', countryCode);
        }
      }
    } catch (primaryError) {
      logger.debug('Primary IP lookup failed:', primaryError);
    }

    // If primary service failed, try backup service
    if (!countryCode) {
      try {
        const response = await fetch(`https://api.iplocation.net/?ip=${ip}`);
        if (response.ok) {
          const data = await response.json();
          if (data.country_code2) {
            countryCode = data.country_code2.toLowerCase();
            logger.debug('Resolved country code from backup service:', countryCode);
          }
        }
      } catch (backupError) {
        logger.debug('Backup IP lookup failed:', backupError);
      }
    }

    // If both services failed, try third service
    if (!countryCode) {
      try {
        const response = await fetch(`https://ipwho.is/${ip}`);
        if (response.ok) {
          const data = await response.json();
          if (data.country_code) {
            countryCode = data.country_code.toLowerCase();
            logger.debug('Resolved country code from third service:', countryCode);
          }
        }
      } catch (thirdError) {
        logger.debug('Third IP lookup failed:', thirdError);
      }
    }

    // If we got a country code, cache it
    if (countryCode) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT OR REPLACE INTO ip_cache (ip, country_code, timestamp) VALUES (?, ?, ?)',
          [ip, countryCode, Date.now()],
          (err) => {
            if (err) reject(err);
            else resolve(null);
          }
        );
      });
      logger.debug('Cached country code for IP:', ip);
    } else {
      logger.debug('Could not resolve country code from any service');
    }

    return countryCode;
  } catch (error) {
    logger.error('Error getting country code:', error);
    return null;
  }
}

// Add cache for ping targets to prevent unnecessary updates
let cachedPingTargets: Array<{target: string, port: number, interval: number}> | null = null;
let lastPingTargetsUpdate = 0;
const PING_CACHE_TTL = 5000; // 5 seconds TTL

// Get all active ping targets with caching
async function getActivePingTargets(): Promise<Array<{target: string, port: number, interval: number}>> {
  const now = Date.now();
  
  // Return cached data if valid
  if (cachedPingTargets && (now - lastPingTargetsUpdate) < PING_CACHE_TTL) {
    return cachedPingTargets;
  }

  return new Promise((resolve, reject) => {
    db.all(
      'SELECT target, port, interval FROM ping_config WHERE is_active = true ORDER BY id ASC', 
      [], 
      (err, rows: any[]) => {
        if (err) {
          logger.error('Error getting ping targets:', err);
          resolve([]); 
        } else {
          // Ensure interval is a number and greater than 0
          const validatedRows = rows.map(row => ({
            ...row,
            interval: Math.max(1, parseInt(row.interval) || 5) // Default to 5 if invalid
          }));
          
          // Update cache
          cachedPingTargets = validatedRows;
          lastPingTargetsUpdate = now;
          
          logger.debug('Updated ping targets cache:', validatedRows);
          resolve(validatedRows);
        }
      }
    );
  });
}

// Function to send ping targets to a specific client
async function sendPingTargetsToClient(socket: any) {
  try {
    const pingTargets = await getActivePingTargets();
    socket.emit('updatePingTargets', { targets: pingTargets });
    logger.debug('Sent ping targets to client:', { 
      socketId: socket.id, 
      targetsCount: pingTargets.length 
    });
  } catch (error) {
    logger.error('Error sending ping targets to client:', error);
  }
}

// Global system info timer
let systemInfoTimer: NodeJS.Timeout | null = null;

function startSystemInfoTimer() {
  // Clear existing timer if any
  if (systemInfoTimer) {
    clearInterval(systemInfoTimer);
    systemInfoTimer = null;
  }

  // Create new timer
  systemInfoTimer = setInterval(() => {
    // Only broadcast if there are connected clients
    if (io.engine.clientsCount > 0) {
      broadcastSystemInfoRequest();
    } else {
      // Stop timer if no clients are connected
      if (systemInfoTimer) {
        clearInterval(systemInfoTimer);
        systemInfoTimer = null;
      }
    }
  }, 3000);

  console.log('System info timer started');
}

// Add interface for client registration data
interface ClientRegistrationData {
  hostname: string;
  ip: string;
  public_ip?: string;
  cpuModel?: string;
  cpuThreads?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  uptime?: number;
  networkTraffic?: {
    rx: string;
    tx: string;
  };
  memoryTotal?: number;
  diskTotal?: number;
}

// Add registerClient function
async function registerClient(data: ClientRegistrationData, socket: any) {
  const {
    hostname,
    ip,
    cpuModel,
    cpuThreads,
    cpuUsage,
    memoryUsage,
    diskUsage,
    uptime,
    networkTraffic,
    memoryTotal,
    diskTotal
  } = data;

  // Get public IP
  const public_ip = await getPublicIP(socket);
  if (!public_ip) {
    logger.error('Failed to get public IP for client:', hostname);
    socket.emit('registration_error', { error: 'Failed to get public IP' });
    return;
  }

  const countryCode = public_ip ? await getCountryCode(public_ip) : null;

  // Check if this is a monitored client
  const monitoredClient = await new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM monitored_clients WHERE hostname = ?',
      [hostname],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });

  if (!monitoredClient) {
    logger.info('Unmonitored client attempted to register:', hostname);
    socket.emit('registration_error', { error: 'Client not monitored' });
    return;
  }

  // Update monitored_clients table with safe update
  await safeUpdateClient(
    db,
    `UPDATE monitored_clients 
     SET status = ?, 
         public_ip = ?, 
         client_ip = ?,
         country_code = ?,
         last_seen = CURRENT_TIMESTAMP 
     WHERE hostname = ?`,
    ['online', public_ip, ip, countryCode, hostname]
  );

  // Insert new client data with safe update
  await safeUpdateClient(
    db,
    `INSERT INTO clients (
      id, hostname, ip, public_ip, country_code, lastSeen,
      cpuModel, cpuThreads, cpuUsage, memoryUsage, diskUsage,
      memoryTotal, diskTotal, uptime, networkRx, networkTx, status
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      socket.id,
      hostname,
      ip,
      public_ip,
      countryCode,
      cpuModel,
      cpuThreads,
      cpuUsage,
      memoryUsage,
      diskUsage,
      memoryTotal,
      diskTotal,
      uptime,
      networkTraffic?.rx || 'Unknown',
      networkTraffic?.tx || 'Unknown',
      'online'
    ]
  );

  // Emit registration success
  socket.emit('registration_success', {
    hostname,
    ip,
    public_ip,
    countryCode,
    cpuModel,
    cpuThreads,
    cpuUsage,
    memoryUsage,
    diskUsage,
    memoryTotal,
    diskTotal,
    uptime,
    networkTraffic
  });
}

// Modify socket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);
  let sshClient: Client | null = null;
  let sshStream: ClientChannel | null = null;

  // Start system info timer if not already running
  if (!systemInfoTimer) {
    startSystemInfoTimer();
  }

  // Client registration
  socket.on('register', async (data: ClientRegistrationData) => {
    try {
      logger.info(`Client ${data.hostname} attempting to register`);
      
      // Get the client's IP addresses
      const clientIp = data.ip;
      const publicIp = await getPublicIP(socket);
      
      if (!publicIp) {
        logger.error('Failed to get public IP for client:', data.hostname);
        socket.emit('registration_error', { error: 'Failed to get public IP' });
        return;
      }

      // Register the client
      await registerClient(data, socket);
      
      // Modify SSH registration logic to avoid duplicates
      const remoteIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
      // Prioritize using public IP for SSH registration
      let sshRegistered = await registerSSHHostname(remoteIp as string);
      
      // Only try client IP registration if client IP differs from public IP and public IP registration fails
      if (!sshRegistered && clientIp !== remoteIp) {
        sshRegistered = await registerSSHHostname(clientIp);
      }
      
      if (!sshRegistered) {
        logger.warn(`Failed to register SSH for client: ${data.hostname}`);
      }
      
      logger.info(`Client ${data.hostname} registered successfully with socket ID: ${socket.id}`);
      
      // Send initial ping targets
      await sendPingTargetsToClient(socket);
    } catch (error) {
      logger.error('Error during client registration:', error);
      socket.emit('registration_error', { error: 'Registration failed' });
    }
  });

  // Update system information
  socket.on('systemInfo', async (data) => {
    try {
      const { hostname, ip, cpuUsage, memoryUsage, diskUsage, cpuModel, uptime, networkTraffic, memoryTotal, diskTotal } = data;
      
      // First check if this socket.id is still the valid connection for this host
      const client = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM clients WHERE id = ?', [socket.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!client) {
        logger.info('Ignoring systemInfo from unregistered socket:', socket.id);
        socket.emit('requireRegistration');
        return;
      }

      logger.info('Updating client data:', {
        hostname,
        networkTraffic,
        memoryTotal,
        diskTotal,
        socketId: socket.id
      });

      await db.run(
        `UPDATE clients SET 
          lastSeen = datetime('now'),
          cpuUsage = ?,
          memoryUsage = ?,
          diskUsage = ?,
          cpuModel = ?,
          memoryTotal = ?,
          diskTotal = ?,
          uptime = ?,
          networkRx = ?,
          networkTx = ?,
          status = 'online'
        WHERE id = ?`,
        [
          cpuUsage,
          memoryUsage,
          diskUsage,
          cpuModel,
          memoryTotal,
          diskTotal,
          uptime,
          networkTraffic.rx,
          networkTraffic.tx,
          socket.id
        ]
      );

      // Update monitored_clients table status simultaneously
      await db.run(
        'UPDATE monitored_clients SET status = ? WHERE hostname = ?',
        ['online', hostname]
      );

      // Broadcast to all connected dashboard clients that system info has been updated
      io.emit('systemInfoUpdate');

    } catch (err) {
      logger.error('Error updating system info:', err);
    }
  });

  // Handle ping result
  socket.on('pingResult', async (data: { latency: number, target: string, port: number }) => {
    try {
      const timestamp = Date.now();
      
      // Get client's hostname
      const client = await new Promise<ClientRow | undefined>((resolve, reject) => {
        db.get('SELECT hostname FROM clients WHERE id = ?', [socket.id], (err, row) => {
          if (err) reject(err);
          else resolve(row as ClientRow);
        });
      });

      if (!client) {
        logger.error('Client not found for socket:', socket.id);
        return;
      }

      // Save ping history record with port
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO ping_history (client_id, hostname, latency, target, port, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [socket.id, client.hostname, data.latency, data.target, data.port, timestamp],
          (err) => {
            if (err) reject(err);
            else resolve(null);
          }
        );
      });

      // Clean up data older than 24 hours
      const oneDayAgo = timestamp - 24 * 60 * 60 * 1000;
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM ping_history WHERE timestamp < ?', [oneDayAgo], (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Update client's latest ping data
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE clients SET pingLatency = ?, pingTimestamp = ? WHERE id = ?',
          [data.latency, timestamp, socket.id],
          (err) => {
            if (err) reject(err);
            else resolve(null);
          }
        );
      });

      logger.info('Ping history updated for client:', client.hostname);
    } catch (error) {
      logger.error('Error handling ping result:', error);
    }
  });

  // Start ping
  socket.on('startPing', async (data) => {
    const { clientId, target } = data;
    logger.info('Start ping request received:', { clientId, target });
    
    // Clean up previous ping interval (if exists)
    if (socket.data.pingInterval) {
      clearInterval(socket.data.pingInterval);
      socket.data.pingInterval = null;
    }

    // Get target client's socket
    const targetSocket = io.sockets.sockets.get(clientId);
    if (!targetSocket) {
      logger.error('Target client not found:', clientId);
      socket.emit('pingError', 'Target client not connected or disconnected');
      return;
    }

    // Set up ping interval
    const pingInterval = setInterval(() => {
      if (!targetSocket.connected) {
        clearInterval(pingInterval);
        socket.emit('pingError', 'Target client disconnected');
        return;
      }
      logger.info('Sending ping request to client:', clientId);
      targetSocket.emit('ping', { target });
    }, 1000);

    socket.data.pingInterval = pingInterval;

    // Handle ping result
    const handlePingResult = (result: { target: string; latency: number }) => {
      logger.info('Received ping result from client:', { clientId, result });
      socket.emit('pingResult', {
        timestamp: Date.now(),
        latency: result.latency
      });
    };

    // Remove previous listener (if exists)
    if (socket.data.handlePingResult) {
      targetSocket.off('pingResult', socket.data.handlePingResult);
    }

    targetSocket.on('pingResult', handlePingResult);
    socket.data.handlePingResult = handlePingResult;
  });

  // Stop ping
  socket.on('stopPing', (data) => {
    const { clientId } = data;
    logger.info('Stop ping request received:', { clientId });

    // Clean up ping interval
    if (socket.data.pingInterval) {
      clearInterval(socket.data.pingInterval);
      socket.data.pingInterval = null;
    }

    // Get target client's socket
    const targetSocket = io.sockets.sockets.get(clientId);
    if (targetSocket && socket.data.handlePingResult) {
      targetSocket.off('pingResult', socket.data.handlePingResult);
      socket.data.handlePingResult = null;
    }
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
    
    // First get current client data
    db.get(
      'SELECT * FROM clients WHERE id = ?',
      [socket.id],
      (err, clientData: DbRow | undefined) => {
        if (err) {
          logger.error('Error finding disconnected client:', err);
          return;
        }

        if (clientData) {
          logger.info(`Client ${clientData.hostname} status changed to down`);
          
          // Update current record to down status but retain all data
          db.run(
            `UPDATE clients 
             SET status = ?, lastSeen = datetime('now')
             WHERE id = ?`,
            ['down', socket.id],
            (err) => {
              if (err) {
                logger.error('Error updating client status:', err);
              }
            }
          );

          // Update monitoring status to down
          db.run(
            'UPDATE monitored_clients SET status = ? WHERE hostname = ?',
            ['down', clientData.hostname],
            (err) => {
              if (err) {
                logger.error('Error updating monitored client status:', err);
              }
            }
          );

          // Save last seen data to new record
          db.run(
            `INSERT INTO clients (
              id, hostname, ip, lastSeen,
              cpuModel, cpuUsage, memoryUsage, diskUsage,
              uptime, networkRx, networkTx, status,
              pingLatency, pingTimestamp, ping_data,
              country_code, public_ip
            ) SELECT
              ? || '-last', hostname, ip, datetime('now'),
              cpuModel, cpuUsage, memoryUsage, diskUsage,
              uptime, networkRx, networkTx, 'last_seen',
              pingLatency, pingTimestamp, ping_data,
              country_code, public_ip
            FROM clients
            WHERE id = ? AND (status = 'online' OR status = 'last_seen')
            ORDER BY lastSeen DESC
            LIMIT 1`,
            [socket.id, socket.id],
            (err) => {
              if (err) {
                logger.error('Error saving last seen data:', err);
              }
            }
          );
        }
      }
    );

    // If no clients are connected, clear the timer
    if (io.engine.clientsCount === 0 && systemInfoTimer) {
      clearInterval(systemInfoTimer);
      systemInfoTimer = null;
    }
  });

  // SSH connection handling
  socket.on('ssh-connect', async (data: { host: string; username: string; password: string }) => {
    try {
      logger.info(`Attempting SSH connection to ${data.host}`);
      
      // Clean up existing connection
      if (sshClient) {
        sshClient.end();
        sshClient = null;
      }
      if (sshStream) {
        sshStream.end();
        sshStream = null;
      }

      // Create new SSH client
      sshClient = new Client();

      let isConnecting = true;

      // Set up connection timeout handling
      const connectionTimeout = setTimeout(() => {
        if (isConnecting) {
          logger.info('SSH connection timeout');
          socket.emit('ssh-error', 'Connection timeout');
          if (sshClient) {
            sshClient.end();
            sshClient = null;
          }
          isConnecting = false;
        }
      }, 20000);

      // Handle SSH client ready
      sshClient.on('ready', () => {
        logger.info('SSH Connection established');
        clearTimeout(connectionTimeout);
        isConnecting = false;

        // Create shell session
        if (!sshClient) {
          logger.error('SSH client is null');
          socket.emit('ssh-error', 'SSH client is null');
          return;
        }

        sshClient.shell({
          term: 'xterm-256color',
          rows: 30,
          cols: 120,
          modes: {
            ECHO: 1,
            ICANON: 1
          }
        }, (err, stream) => {
          if (err) {
            logger.error('SSH shell error:', err);
            socket.emit('ssh-error', err.message);
            return;
          }

          sshStream = stream;

          // Wait for shell to be ready
          stream.once('ready', () => {
            logger.info('Shell stream is ready');
            socket.emit('ssh-connected');
            
            // Send initial command to trigger prompt
            stream.write('\r');
          });

          // Handle shell data
          stream.on('data', (data: Buffer) => {
            const output = data.toString('utf8');
            socket.emit('ssh-data', output);
          });

          // Handle stderr data
          stream.stderr.on('data', (data: Buffer) => {
            const output = data.toString('utf8');
            socket.emit('ssh-data', output);
          });

          // Handle shell close
          stream.on('close', () => {
            logger.info('SSH Stream closed');
            socket.emit('ssh-closed');
          });

          // Handle shell error
          stream.on('error', (err: Error) => {
            logger.error('SSH Stream error:', err);
            socket.emit('ssh-error', err.message);
          });
        });
      });

      // Handle SSH client error
      sshClient.on('error', (err) => {
        logger.error('SSH Client error:', err);
        clearTimeout(connectionTimeout);
        socket.emit('ssh-error', err.message);
        if (sshClient) {
          sshClient.end();
          sshClient = null;
        }
      });

      // Handle SSH client close
      sshClient.on('close', () => {
        logger.info('SSH Client closed');
        socket.emit('ssh-closed');
        if (sshClient) {
          sshClient.end();
          sshClient = null;
        }
      });

      // Handle SSH client end
      sshClient.on('end', () => {
        logger.info('SSH Client ended');
        socket.emit('ssh-closed');
        if (sshClient) {
          sshClient.end();
          sshClient = null;
        }
      });

      // Try to establish SSH connection
      sshClient.connect({
        host: data.host,
        port: 22,
        username: data.username,
        password: data.password,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
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

    } catch (err: any) {
      logger.error('SSH connection error:', err);
      socket.emit('ssh-error', err.message);
      if (sshClient) {
        sshClient.end();
        sshClient = null;
      }
    }
  });

  // Handle client input
  socket.on('ssh-data', (data: string) => {
    if (sshStream && sshStream.writable) {
      sshStream.write(data);
    } else {
      socket.emit('ssh-error', 'SSH connection not established');
    }
  });

  // Handle terminal size adjustment
  socket.on('ssh-resize', (data: { cols: number; rows: number }) => {
    if (sshStream) {
      sshStream.setWindow(data.rows, data.cols, 0, 0);
    }
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
    if (sshStream) {
      sshStream.end();
      sshStream = null;
    }
    if (sshClient) {
      sshClient.end();
      sshClient = null;
    }

    // If no clients are connected, clear the timer
    if (io.engine.clientsCount === 0 && systemInfoTimer) {
      clearInterval(systemInfoTimer);
      systemInfoTimer = null;
    }
  });

  // Start the system info timer if it's not already running
  if (!systemInfoTimer) {
    startSystemInfoTimer();
  }
});

// Add type definitions
interface DbClient {
  id: string;
  hostname: string;
  ip: string;
  lastSeen: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  cpuModel: string;
  uptime: number;
  networkRx: string;
  networkTx: string;
}

interface MonitoredClientRow {
  hostname: string;
  status: string;
  sort_order: number;
  created_at: string;
  client_ip?: string;
  public_ip?: string;
  country_code?: string;
  last_seen?: string;
  tags?: string;
}

// API routes
app.get('/api/clients', async (req, res) => {
  try {
    const oneDayAgo = Date.now() - PING_HISTORY_RETENTION;
    
    // Add index hint for better query performance
    const query = `
      WITH LastOnlineData AS (
        SELECT 
          c2.hostname,
          c2.id,
          c2.ip,
          c2.country_code,
          c2.cpuUsage,
          c2.cpuThreads,
          c2.memoryUsage,
          c2.diskUsage,
          c2.cpuModel,
          c2.memoryTotal,
          c2.diskTotal,
          c2.uptime,
          c2.networkRx,
          c2.networkTx,
          c2.lastSeen,
          c2.status,
          c2.pingLatency,
          c2.pingTimestamp,
          c2.ping_data
        FROM clients c2 INDEXED BY idx_clients_hostname_lastSeen
        WHERE (c2.hostname, c2.lastSeen) IN (
          SELECT hostname, MAX(lastSeen)
          FROM clients
          WHERE (status = 'online' OR status = 'last_seen')
            AND networkRx IS NOT NULL 
            AND networkTx IS NOT NULL
          GROUP BY hostname
        )
        ORDER BY c2.hostname
      )
      SELECT DISTINCT
        mc.hostname as mc_hostname,
        mc.status as mc_status,
        mc.sort_order as sort_order,
        mc.created_at as created_at,
        COALESCE(c.id, lod.id, 'pending-' || mc.hostname) as id,
        COALESCE(c.ip, lod.ip) as ip,
        COALESCE(c.country_code, lod.country_code) as country_code,
        COALESCE(c.lastSeen, lod.lastSeen) as lastSeen,
        COALESCE(c.cpuUsage, lod.cpuUsage, 0) as cpuUsage,
        COALESCE(c.cpuThreads, lod.cpuThreads, 0) as cpuThreads,
        COALESCE(c.memoryUsage, lod.memoryUsage, 0) as memoryUsage,
        COALESCE(c.diskUsage, lod.diskUsage, 0) as diskUsage,
        COALESCE(c.memoryTotal, lod.memoryTotal, 0) as memoryTotal,
        COALESCE(c.diskTotal, lod.diskTotal, 0) as diskTotal,
        COALESCE(c.cpuModel, lod.cpuModel) as cpuModel,
        COALESCE(c.uptime, lod.uptime, 0) as uptime,
        COALESCE(c.networkRx, lod.networkRx, 'Unknown') as networkRx,
        COALESCE(c.networkTx, lod.networkTx, 'Unknown') as networkTx,
        (
          SELECT json_group_array(tag)
          FROM client_tags
          WHERE hostname = mc.hostname
        ) as tags,
        COALESCE(
          (
            SELECT json_group_array(
              json_object(
                'timestamp', ph.timestamp,
                'latency', CAST(ph.latency as REAL),
                'target', ph.target
              )
            )
            FROM ping_history ph
            WHERE ph.hostname = mc.hostname
            AND ph.timestamp > ?
            ORDER BY ph.timestamp ASC
          ),
          '[]'
        ) as ping_history
      FROM monitored_clients mc
      LEFT JOIN (
        SELECT * FROM clients 
        WHERE id IN (
          SELECT id FROM clients 
          GROUP BY hostname 
          HAVING MAX(lastSeen)
        )
        ORDER BY hostname
        ) c ON c.hostname = mc.hostname
      LEFT JOIN LastOnlineData lod ON lod.hostname = mc.hostname
      ORDER BY 
        CASE 
          WHEN mc.sort_order IS NULL THEN 0 
          ELSE mc.sort_order 
        END DESC,
        mc.created_at ASC
    `;

    db.all(query, [oneDayAgo], (err, rows) => {
      if (err) {
        logger.error('Error fetching clients:', err);
        res.status(500).json({ error: 'Internal server error' });
        return;
      }

      const processedRows = rows.map((row: any) => {
        let pingHistory: any[] = [];
        let tags: string[] = [];

        try {
          // Ensure ping_history is valid JSON string
          if (row.ping_history && typeof row.ping_history === 'string') {
            pingHistory = JSON.parse(row.ping_history);
          }
          // Ensure each data point is correctly processed
          pingHistory = pingHistory.map((ph: any) => ({
            timestamp: typeof ph.timestamp === 'string' ? parseInt(ph.timestamp) : ph.timestamp,
            latency: ph.latency,
            target: ph.target
          }));

          // Handle tags
          if (row.tags && typeof row.tags === 'string') {
            tags = JSON.parse(row.tags);
          }
        } catch (error) {
          logger.error('Error processing row data:', error);
        }

        // Check request source
        const isInternalRequest = req.headers['x-internal-request'] === 'true';

        // Create base response object
        const responseObj = {
          id: row.id || '',
          hostname: row.mc_hostname,
          status: row.mc_status,
          sort_order: row.sort_order,
          created_at: row.created_at,
          tags,
          ping_history: pingHistory,
          lastSeen: row.lastSeen || null,
          countryCode: row.country_code || null,
          cpuUsage: typeof row.cpuUsage === 'string' ? parseFloat(row.cpuUsage) : row.cpuUsage || 0,
          cpuThreads: typeof row.cpuThreads === 'string' ? parseInt(row.cpuThreads) : row.cpuThreads || 0,
          memoryUsage: typeof row.memoryUsage === 'string' ? parseFloat(row.memoryUsage) : row.memoryUsage || 0,
          diskUsage: typeof row.diskUsage === 'string' ? parseFloat(row.diskUsage) : row.diskUsage || 0,
          memoryTotal: typeof row.memoryTotal === 'string' ? parseInt(row.memoryTotal) : row.memoryTotal || 0,
          diskTotal: typeof row.diskTotal === 'string' ? parseInt(row.diskTotal) : row.diskTotal || 0,
          cpuModel: row.cpuModel || null,
          uptime: typeof row.uptime === 'string' ? parseInt(row.uptime) : row.uptime || 0,
          networkTraffic: {
            rx: formatNetworkTraffic(row.networkRx),
            tx: formatNetworkTraffic(row.networkTx)
          },
        };

        // Only add IP information in internal requests
        if (isInternalRequest) {
          return {
            ...responseObj,
            ip: row.ip,
            public_ip: row.public_ip,
            country_code: row.country_code
          };
        }

        return responseObj;
      });

      res.json(processedRows);
    });
  } catch (error) {
    logger.error('Error in /api/clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send ping command to specific client
app.post('/api/ping/:clientId', (req, res) => {
  const { clientId } = req.params;
  const { target } = req.body;
  
  logger.info('Ping request received:', { clientId, target });
  
  const clientSocket = io.sockets.sockets.get(clientId);
  if (!clientSocket) {
    logger.info('Client not found:', clientId);
    res.status(404).json({ error: 'Client not connected or disconnected' });
    return;
  }

  clientSocket.emit('ping', { target });
  logger.info('Ping command sent to client:', clientId);
  res.json({ message: 'Ping command sent' });
});

// Get all monitored clients
app.get('/api/monitored-clients', (req, res) => {
  const query = `
    SELECT 
      mc.*,
      c.ip as client_ip,
      c.public_ip as public_ip,
      c.country_code as country_code,
      c.lastSeen as last_seen,
      (
        SELECT json_group_array(tag)
        FROM client_tags
        WHERE hostname = mc.hostname
      ) as tags
    FROM monitored_clients mc
    LEFT JOIN (
      SELECT hostname, ip, public_ip, country_code, lastSeen
      FROM clients
      WHERE id IN (
        SELECT id
        FROM clients
        GROUP BY hostname
        HAVING MAX(lastSeen)
      )
    ) c ON c.hostname = mc.hostname
    ORDER BY mc.sort_order DESC, mc.created_at ASC
  `;

  db.all(query, [], (err, rows: MonitoredClientRow[]) => {
    if (err) {
      logger.error('Error fetching monitored clients:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Handle tags data
    const processedRows = rows.map(row => {
      let tags: string[] = [];
      try {
        if (row.tags) {
          tags = JSON.parse(row.tags);
        }
      } catch (e) {
        logger.error('Error parsing tags:', e);
      }
      return {
        ...row,
        tags
      };
    });

    res.json(processedRows);
  });
});

// Add new monitored client
app.post('/api/monitored-clients', (req, res) => {
  const { hostname } = req.body;
  if (!hostname) {
    return res.status(400).json({ error: 'Hostname is required' });
  }

  // First check if it exists
  db.get('SELECT hostname FROM monitored_clients WHERE hostname = ?', [hostname], (err, row) => {
    if (err) {
      logger.error('Error checking existing client:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (row) {
      return res.status(400).json({ error: 'Hostname already exists' });
    }

    // If not exists, insert new record
    db.run(
      'INSERT INTO monitored_clients (hostname, status, sort_order) VALUES (?, ?, ?)',
      [hostname, 'pending', 0],
      (err) => {
        if (err) {
          logger.error('Error adding monitored client:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ message: 'Monitored client added successfully', hostname });
      }
    );
  });
});

// Update client sort order
app.put('/api/monitored-clients/:hostname/sort', (req, res) => {
  const { hostname } = req.params;
  const { sort_order } = req.body;

  if (typeof sort_order !== 'number') {
    return res.status(400).json({ error: 'Sort order must be a number' });
  }

  db.run(
    'UPDATE monitored_clients SET sort_order = ? WHERE hostname = ?',
    [sort_order, hostname],
    (err) => {
      if (err) {
        logger.error('Error updating client sort order:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ message: 'Sort order updated successfully' });
    }
  );
});

// Delete monitored client
app.delete('/api/monitored-clients/:hostname', async (req, res) => {
  try {
    // Double decode the hostname parameter to handle special characters
    const hostname = decodeURIComponent(decodeURIComponent(req.params.hostname));

    // Start transaction
    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT hostname FROM monitored_clients WHERE hostname = ?', [hostname], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      await new Promise((resolve) => db.run('ROLLBACK', () => resolve(null)));
      return res.status(404).json({ error: 'Client not found' });
    }

    // Delete ping_history table data
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM ping_history WHERE hostname = ?', [hostname], (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Delete clients table data
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM clients WHERE hostname = ?', [hostname], (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Delete monitored_clients table data
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM monitored_clients WHERE hostname = ?', [hostname], (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Commit transaction
    await new Promise((resolve, reject) => {
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    res.json({ message: 'Client and all related data deleted successfully' });
  } catch (error) {
    // Rollback transaction if error occurs
    await new Promise((resolve) => db.run('ROLLBACK', () => resolve(null)));
    logger.error('Error during client deletion:', error);
    res.status(500).json({ error: 'Failed to delete client and related data' });
  }
});

// Get current ping target
async function getCurrentPingTarget(): Promise<string> {
  return new Promise((resolve, reject) => {
    db.get('SELECT target FROM ping_config ORDER BY id DESC LIMIT 1', [], (err, row: any) => {
      if (err) {
        logger.error('Error getting ping target:', err);
        resolve('8.8.8.8'); // Default value
      } else {
        resolve(row?.target || '8.8.8.8');
      }
    });
  });
}

// API endpoints
app.get('/api/ping-config', (req, res) => {
  db.all('SELECT * FROM ping_config WHERE is_active = true', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/ping-config', async (req, res) => {
  const { target, description = '', display_name = '', port = 80, interval = 5 } = req.body;
  if (!target) {
    res.status(400).json({ error: 'Target host is required' });
    return;
  }

  // Validate target format (IP address or domain name)
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!ipRegex.test(target) && !domainRegex.test(target)) {
    return res.status(400).json({ error: 'Invalid target format. Please enter a valid IP address or domain name' });
  }

  // Validate port and interval
  if (port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Port must be between 1 and 65535' });
  }

  // Ensure interval is a positive number
  const validInterval = Math.max(1, parseInt(String(interval)) || 5);

  try {
    // Start transaction
    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Insert new configuration with validated interval
    const result = await new Promise<number>((resolve, reject) => {
      db.run(
        'INSERT INTO ping_config (target, description, display_name, port, interval) VALUES (?, ?, ?, ?, ?)',
        [target, description, display_name, port, validInterval],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // Commit transaction
    await new Promise((resolve, reject) => {
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Invalidate cache
    cachedPingTargets = null;
    
    // Get updated ping targets
    const pingTargets = await getActivePingTargets();
    
    // Notify all connected clients to update their ping targets
    io.emit('updatePingTargets', { targets: pingTargets });
    
    // Log the update
    logger.info('New ping configuration added and clients notified:', {
      newTarget: target,
      port,
      interval: validInterval,
      allTargets: pingTargets
    });

    res.json({ id: result });
  } catch (err) {
    // If error occurs, rollback transaction
    await new Promise((resolve) => {
      db.run('ROLLBACK', () => resolve(null));
    });
    logger.error('Error adding ping configuration:', err);
    res.status(500).json({ error: 'Failed to add ping configuration' });
  }
});

app.put('/api/ping-config/:id', (req, res) => {
  const { target, description, display_name, is_active } = req.body;
  const { id } = req.params;

  db.run(
    'UPDATE ping_config SET target = ?, description = ?, display_name = ?, is_active = ? WHERE id = ?',
    [target, description, display_name, is_active, id],
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true });
    }
  );
});

app.delete('/api/ping-config/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT target FROM ping_config WHERE id = ?', [id], async (err, row: any) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Ping target not found' });
      return;
    }

    const target = row.target;

    try {
      // Start transaction
      await new Promise((resolve, reject) => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Delete ping configuration
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM ping_config WHERE id = ?', [id], (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Delete related ping history data
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM ping_history WHERE target = ?', [target], (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Commit transaction
      await new Promise((resolve, reject) => {
        db.run('COMMIT', (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Invalidate cache
      cachedPingTargets = null;
      
      // Get updated ping targets
      const pingTargets = await getActivePingTargets();
      
      // Notify all connected clients to update their ping targets
      io.emit('updatePingTargets', { targets: pingTargets });
      
      res.json({ success: true });
    } catch (err) {
      // If error occurs, rollback transaction
      await new Promise((resolve) => {
        db.run('ROLLBACK', () => resolve(null));
      });
      logger.error('Error during ping target deletion:', err);
      res.status(500).json({ error: 'Failed to delete ping target and history' });
    }
  });
});

// API endpoints
app.get('/api/ping-targets', (req, res) => {
  db.all('SELECT * FROM ping_config WHERE is_active = true', (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/ping-targets', (req, res) => {
  const { target, description, display_name } = req.body;
  if (!target) {
    res.status(400).json({ error: 'Target IP is required' });
    return;
  }

  db.run(
    'INSERT INTO ping_config (target, description, display_name) VALUES (?, ?, ?)',
    [target, description, display_name],
    function(err) {
      if (err) {
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/ping-targets/:id', (req, res) => {
  const { target, description, display_name, is_active } = req.body;
  const { id } = req.params;

  db.run(
    'UPDATE ping_config SET target = ?, description = ?, display_name = ?, is_active = ? WHERE id = ?',
    [target, description, display_name, is_active, id],
    (err) => {
      if (err) {
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      res.json({ success: true });
    }
  );
});

app.delete('/api/ping-targets/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM ping_config WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
    res.json({ success: true });
  });
});

// Add password verification and setting related routes

// Check if password is set
app.get('/api/admin/password-status', async (req, res) => {
  db.get('SELECT id FROM admin_password LIMIT 1', (err, row) => {
    if (err) {
      res.status(500).json({ error: 'Server error' });
      return;
    }
    res.json({ isSet: !!row });
  });
});

// Set initial password
app.post('/api/admin/set-password', async (req, res) => {
  const { password } = req.body;
  
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  db.get('SELECT id FROM admin_password LIMIT 1', async (err, row) => {
    if (err) {
      res.status(500).json({ error: 'Server error' });
      return;
    }

    if (row) {
      res.status(400).json({ error: 'Password has already been set' });
      return;
    }

    try {
      const saltRounds = 10;
      const hash = await bcrypt.hash(password, saltRounds);
      
      db.run('INSERT INTO admin_password (password_hash) VALUES (?)', [hash], (err) => {
        if (err) {
          res.status(500).json({ error: 'Failed to set password' });
          return;
        }
        res.json({ success: true });
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to encrypt password' });
    }
  });
});

// Add admin password record interface definition
interface AdminPasswordRow {
  id: number;
  password_hash: string;
  created_at: string;
}

// Verify password
app.post('/api/admin/verify-password', async (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    res.status(400).json({ error: 'Please enter password' });
    return;
  }

  db.get('SELECT password_hash FROM admin_password LIMIT 1', async (err, row: AdminPasswordRow | undefined) => {
    if (err) {
      res.status(500).json({ error: 'Server error' });
      return;
    }

    if (!row) {
      res.status(400).json({ error: 'Password not set' });
      return;
    }

    try {
      const match = await bcrypt.compare(password, row.password_hash);
      if (match) {
        // Generate JWT token
        const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
        res.json({ success: true, token });
      } else {
        res.status(401).json({ error: 'Incorrect password' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Password verification failed' });
    }
  });
});

// Add token verification middleware
const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Add token verification endpoint
app.post('/api/admin/verify-token', verifyToken, (req, res) => {
  res.json({ success: true });
});

// Change password
app.post('/api/admin/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Please provide current password and new password' });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
    return;
  }

  try {
    // Get current password hash
    const row = await new Promise<AdminPasswordRow | undefined>((resolve, reject) => {
      db.get('SELECT password_hash FROM admin_password LIMIT 1', (err, row) => {
        if (err) reject(err);
        else resolve(row as AdminPasswordRow | undefined);
      });
    });

    if (!row) {
      res.status(400).json({ error: 'Password not set' });
      return;
    }

    // Verify current password
    const match = await bcrypt.compare(currentPassword, row.password_hash);
    if (!match) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Generate new password hash
    const saltRounds = 10;
    const newHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE admin_password SET password_hash = ?, created_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM admin_password LIMIT 1)',
        [newHash],
        (err) => {
          if (err) reject(err);
          else resolve(null);
        }
      );
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Add tag
app.post('/api/client/add-tag', async (req, res) => {
  const { hostname, tag } = req.body;

  if (!hostname || !tag) {
    return res.status(400).json({ error: 'Hostname and tag are required' });
  }

  try {
    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT hostname FROM monitored_clients WHERE hostname = ?', [hostname], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Add tag
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO client_tags (hostname, tag) VALUES (?, ?)', [hostname, tag], (err) => {
        if (err) {
          // If it's a unique constraint error (tag already exists), return specific error
          if (err.message.includes('UNIQUE constraint failed')) {
            reject(new Error('Tag already exists for this client'));
          } else {
            reject(err);
          }
        } else {
          resolve(null);
        }
      });
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Error adding tag:', error);
    if (error.message === 'Tag already exists for this client') {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to add tag' });
    }
  }
});

// Add tag deletion endpoint
app.delete('/api/tags/:hostname/:tag', async (req, res) => {
  const { hostname, tag } = req.params;
  
  try {
    await new Promise<void>((resolve, reject) => {
      db.run(
        'DELETE FROM client_tags WHERE hostname = ? AND tag = ?',
        [hostname, tag],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    res.status(200).json({ message: 'Tag deleted successfully' });
  } catch (error) {
    logger.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

// Add function to safely update client data
async function safeUpdateClient(db: sqlite3.Database, sql: string, params: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) {
        // Check if the error is due to missing column
        if (err.message.includes('no such column')) {
          logger.warn('Column missing in database, attempting to add it...');
          // Handle missing column error gracefully
          resolve();
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
}

// Add database indexes for better query performance
db.serialize(() => {
  db.run('CREATE INDEX IF NOT EXISTS idx_clients_hostname_lastSeen ON clients(hostname, lastSeen)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ping_history_timestamp ON ping_history(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status)');
});

// Add type definitions for IP services response
interface IpifyResponse {
  ip: string;
}

interface MyIpResponse {
  ip: string;
}

// Add server info endpoint
app.get('/api/server-info', async (req: Request, res: Response) => {
  try {
    // Check if this is an internal request from AdminDashboard
    const isInternalRequest = req.headers['x-internal-request'] === 'true';

    if (!isInternalRequest) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    // Create server_info table if it doesn't exist (failsafe)
    await new Promise((resolve, reject) => {
      db.run(`CREATE TABLE IF NOT EXISTS server_info (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      )`, (err) => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    // Check if there's a cached IP that's less than 5 minutes old
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes
    const cachedIP = await new Promise<ServerInfoRow | null>((resolve, reject) => {
      db.get(
        'SELECT value, updated_at FROM server_info WHERE key = ? AND (? - updated_at) < ?',
        ['public_ip', Date.now(), cacheTimeout],
        (err, row) => {
          if (err) {
            logger.error('Error querying cached IP:', err);
            resolve(null);
          } else {
            resolve(row as ServerInfoRow | null);
          }
        }
      );
    });

    if (cachedIP?.value) {
      logger.info('Using cached IP:', cachedIP.value);
      return res.json({ public_ip: cachedIP.value });
    }

    // Try multiple IP lookup services in sequence
    const ipServices = [
      'https://api.ipify.org?format=json',
      'https://api.ip.sb/ip',
      'https://api.myip.com'
    ];

    let publicIP: string | null = null;
    let lastError: unknown = null;

    for (const service of ipServices) {
      try {
        logger.info('Trying IP service:', service);
        const response = await fetch(service);
        if (!response.ok) {
          logger.warn(`Service ${service} returned status ${response.status}`);
          continue;
        }
        
        const data = await response.text();
        // Handle different response formats
        if (service.includes('ipify')) {
          const jsonData = JSON.parse(data) as IpifyResponse;
          publicIP = jsonData.ip;
        } else if (service.includes('ip.sb')) {
          publicIP = data.trim();
        } else if (service.includes('myip.com')) {
          const jsonData = JSON.parse(data) as MyIpResponse;
          publicIP = jsonData.ip;
        }

        if (publicIP) {
          logger.info('Successfully obtained IP from', service);
          break;
        }
      } catch (e) {
        lastError = e;
        logger.warn(`Failed to fetch IP from ${service}:`, e);
        continue;
      }
    }

    if (!publicIP) {
      logger.error('Failed to fetch public IP from all services:', lastError);
      return res.status(500).json({ error: 'Failed to fetch server public IP' });
    }

    // Cache the IP
    try {
      const timestamp = Date.now();
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT OR REPLACE INTO server_info (key, value, updated_at) VALUES (?, ?, ?)',
          ['public_ip', publicIP, timestamp],
          (err) => {
            if (err) reject(err);
            else resolve(null);
          }
        );
      });
      logger.info('Successfully cached IP:', publicIP);
    } catch (err) {
      logger.error('Failed to cache IP:', err);
      // Even if caching fails, we can still return the IP
    }

    return res.json({ public_ip: publicIP });
  } catch (error) {
    logger.error('Error in /api/server-info endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Add service name endpoints
app.get('/api/service-name', async (req, res) => {
  try {
    const row = await new Promise<ServerInfoRow | null>((resolve, reject) => {
      db.get(
        'SELECT value FROM server_info WHERE key = ?',
        ['service_name'],
        (err, row) => {
          if (err) {
            logger.error('Error querying service name:', err);
            reject(err);
          } else {
            resolve(row as ServerInfoRow | null);
          }
        }
      );
    });

    res.json({ name: row?.value || 'Services' });
  } catch (error) {
    logger.error('Error in /api/service-name endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/service-name', async (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Service name is required' });
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR REPLACE INTO server_info (key, value, updated_at) VALUES (?, ?, ?)',
        ['service_name', name, Date.now()],
        (err) => {
          if (err) reject(err);
          else resolve(null);
        }
      );
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating service name:', error);
    res.status(500).json({ error: 'Failed to update service name' });
  }
});

// Add broadcast system info request function
function broadcastSystemInfoRequest() {
  try {
    // 只向已连接的客户端广播请求
    io.emit('requestSystemInfo');
  } catch (error) {
    logger.error('Error broadcasting system info request:', error);
  }
}

// Add endpoint for frontend to trigger system info update
app.post('/api/request-system-info', (req, res) => {
  broadcastSystemInfoRequest();
  res.json({ success: true });
});

// Add cleanup on server shutdown
process.on('SIGTERM', () => {
  if (systemInfoTimer) {
    clearInterval(systemInfoTimer);
    systemInfoTimer = null;
  }
  // ... existing shutdown code ...
});

process.on('SIGINT', () => {
  if (systemInfoTimer) {
    clearInterval(systemInfoTimer);
    systemInfoTimer = null;
  }
  // ... existing shutdown code ...
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Add type definition for server info row
interface ServerInfoRow {
  value: string;
  updated_at: number;
}