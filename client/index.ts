import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import debug from 'debug';
import os from 'os';
import socketIOClient from 'socket.io-client';
import axios from 'axios';
import type { NetworkInterfaceInfo } from 'os';
import path from 'path';
import winston from 'winston';

// Optimize log configuration
const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // Reduce to 5MB
const MAX_LOG_FILES = 3; // Reduce to 3 files
const LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const LOG_RETENTION_DAYS = 7; // Add retention period

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configure winston logger with optimized format
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      // Optimize log format to reduce size
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} ${level}: ${message} ${metaStr}`.trim();
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      handleExceptions: true,
      handleRejections: true
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      handleExceptions: true,
      handleRejections: true,
      zippedArchive: true,
      tailable: true
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      zippedArchive: true,
      tailable: true
    })
  ],
  exitOnError: false
});

// Optimize cleanup interval (run every 12 hours instead of 24)
setInterval(cleanupOldLogs, 12 * 60 * 60 * 1000);

// Optimize log cleanup function
async function cleanupOldLogs() {
  try {
    const files = await fs.promises.readdir(LOG_DIR);
    const now = Date.now();
    const retentionPeriod = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let totalSize = 0;
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(LOG_DIR, file);
        const stats = await fs.promises.stat(filePath);
        totalSize += stats.size;
        return { file, filePath, stats };
      })
    );

    // Sort files by modification time (oldest first)
    fileStats.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);

    for (const { file, filePath, stats } of fileStats) {
      // Delete files older than retention period
      if (now - stats.mtimeMs > retentionPeriod) {
        await fs.promises.unlink(filePath);
        logger.info(`Deleted old log file: ${file}`);
        continue;
      }

      // If total size exceeds limit (50MB), delete oldest files
      if (totalSize > 50 * 1024 * 1024) {
        await fs.promises.unlink(filePath);
        totalSize -= stats.size;
        logger.info(`Deleted log file due to size limit: ${file}`);
      }
    }
  } catch (error) {
    logger.error('Error cleaning up old logs:', error);
  }
}

// Replace console.log calls with logger
const log = logger;

// Parse command line arguments
const args = process.argv.slice(2);
const serverAddress = args[0]?.replace(/^"|"$/g, '') || 'localhost:3000';

// Properly handle hostname with special characters
const customHostname = args[1] ? 
  // If hostname is provided, unescape it and remove any surrounding quotes
  args[1].replace(/^"|"$/g, '').replace(/\\(.)/g, '$1') : 
  os.hostname();

if (args.length < 2) {
  log.warn('Running with default arguments', { 
    serverAddress, 
    customHostname,
    usage: 'node index.js "<server-address>" "<custom-hostname>"',
    example: 'node index.js "192.168.1.100:3000" "my-client-1"'
  });
}

export const execAsync = promisify(exec);

// Update socket connection to use provided server address
const socket = socketIOClient(`ws://${serverAddress}`, {
  transports: ['websocket'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 20000,
  forceNew: false,
  multiplex: true
});

// Store current ping targets and their timers
interface PingTarget {
  target: string;
  port: number;
  interval: number;
  timer?: NodeJS.Timeout;
}

let currentPingTargets: PingTarget[] = [];

interface SystemInfo {
  hostname: string;
  ip: string;
  public_ip: string;
  cpuModel: string;
  cpuThreads: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  memoryTotal: number;
  diskTotal: number;
  uptime: number;
  networkTraffic: {
    rx: string;
    tx: string;
  };
}

// Get CPU usage
interface CpuInfo {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

let lastCpuInfo: CpuInfo | null = null;

async function getCpuUsage(): Promise<number> {
  try {
    // Read /proc/stat for more accurate CPU usage
    const statContent = await fs.promises.readFile('/proc/stat', 'utf8');
    const cpuLines = statContent.split('\n').filter(line => line.startsWith('cpu'));
    
    // Get the aggregate CPU line (cpu ...)
    const cpuLine = cpuLines[0];
    const values = cpuLine.split(/\s+/).slice(1).map(Number);
    
    const current: CpuInfo = {
      user: values[0],
      nice: values[1],
      sys: values[2],
      idle: values[3],
      irq: values[6]
    };
    
    if (!lastCpuInfo) {
      lastCpuInfo = current;
      // Wait a short interval for the first measurement
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getCpuUsage();
    }
    
    // Calculate deltas
    const userDiff = current.user - lastCpuInfo.user;
    const niceDiff = current.nice - lastCpuInfo.nice;
    const sysDiff = current.sys - lastCpuInfo.sys;
    const idleDiff = current.idle - lastCpuInfo.idle;
    const irqDiff = current.irq - lastCpuInfo.irq;
    
    // Calculate total time difference
    const totalDiff = userDiff + niceDiff + sysDiff + idleDiff + irqDiff;
    
    // Calculate CPU usage percentage
    const cpuUsage = totalDiff > 0 ? 
      ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
    
    // Update last info for next calculation
    lastCpuInfo = current;
    
    return Math.round(cpuUsage * 100) / 100;
  } catch (error) {
    // Fallback to os.cpus() if /proc/stat is not available
    const cpus = os.cpus();
    const avgUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;
    
    return Math.round(avgUsage * 100) / 100;
  }
}

// Get memory usage
async function getMemoryUsage(): Promise<number> {
  try {
    // Read /proc/meminfo for more accurate memory information
    const memContent = await fs.promises.readFile('/proc/meminfo', 'utf8');
    const memInfo: { [key: string]: number } = {};
    
    memContent.split('\n').forEach(line => {
      const matches = line.match(/^(\w+):\s+(\d+)/);
      if (matches) {
        memInfo[matches[1]] = parseInt(matches[2]);
      }
    });
    
    // Calculate actual used memory (similar to htop)
    const total = memInfo['MemTotal'] || 0;
    const free = memInfo['MemFree'] || 0;
    const buffers = memInfo['Buffers'] || 0;
    const cached = memInfo['Cached'] || 0;
    const sReclaimable = memInfo['SReclaimable'] || 0;
    
    // Used = Total - Free - Buffers - (Cached + SReclaimable)
    const used = total - free - buffers - (cached + sReclaimable);
    const usagePercentage = (used / total) * 100;
    
    return Math.round(usagePercentage * 100) / 100;
  } catch (error) {
    // Fallback to os.freemem() if /proc/meminfo is not available
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usagePercentage = ((totalMemory - freeMemory) / totalMemory) * 100;
    return Math.round(usagePercentage * 100) / 100;
  }
}

// Get disk usage
async function getDiskUsage(): Promise<number> {
  try {
    // Get usage for all mount points (excluding special filesystems)
    const { stdout } = await execAsync('df -k | grep -vE "^(tmpfs|devtmpfs|udev|none|overlay|shm)" | tail -n +2');
    const lines = stdout.trim().split('\n');
    
    let totalSize = 0;
    let totalUsed = 0;
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      const size = parseInt(parts[1]); // Total size (KB)
      const used = parseInt(parts[2]); // Used space (KB)
      
      if (!isNaN(size) && !isNaN(used)) {
        totalSize += size;
        totalUsed += used;
      }
    });
    
    // Calculate total usage percentage
    const usagePercentage = totalSize > 0 ? (totalUsed / totalSize) * 100 : 0;
    return Math.round(usagePercentage * 100) / 100;
  } catch (error) {
    console.error('Error getting disk usage:', error);
    return 0;
  }
}

// Get network traffic
async function getNetworkTraffic(): Promise<{ rx: string; tx: string }> {
  try {
    // Read /proc/net/dev file to get network traffic
    const netData = await fs.promises.readFile('/proc/net/dev', 'utf8');

    // Parse traffic for all network interfaces (excluding lo interface)
    let totalRx = 0;
    let totalTx = 0;

    netData.split('\n').forEach(line => {
      if (line.includes(':')) {
        const parts = line.trim().split(/\s+/);
        const iface = parts[0].replace(':', '');
        if (iface !== 'lo') {  // Exclude loopback interface
          totalRx += parseInt(parts[1], 10);  // Received bytes
          totalTx += parseInt(parts[9], 10);  // Transmitted bytes
        }
      }
    });

    // Convert to appropriate units, using 1024 instead of 1000 as the conversion base
    const formatBytes = (bytes: number): string => {
      if (isNaN(bytes) || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      // For values greater than 1024, keep two decimal places
      if (i > 0) {
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
      }
      // For values less than 1024, do not use decimal
      return `${Math.round(bytes)} ${sizes[0]}`;
    };

    const rx = formatBytes(totalRx);
    const tx = formatBytes(totalTx);

    console.log('Network traffic:', { rx, tx, totalRx, totalTx });
    return { rx, tx };
  } catch (error) {
    console.error('Error getting network traffic:', error);
    return { rx: 'unknown', tx: 'unknown' };
  }
}

// Get total disk size
async function getDiskTotal(): Promise<number> {
  try {
    const { stdout } = await execAsync('df -k | grep -vE "^(tmpfs|devtmpfs|udev|none|overlay|shm)" | tail -n +2');
    const lines = stdout.trim().split('\n');
    
    let totalSize = 0;
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      const size = parseInt(parts[1]); // Total size (KB)
      
      if (!isNaN(size)) {
        totalSize += size;
      }
    });
    
    return totalSize * 1024; // Convert to bytes
  } catch (error) {
    log.error('Error getting disk total:', error);
    return 0;
  }
}

// Get system information
async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const hostname = customHostname;
    const networkInterfaces = os.networkInterfaces();
    const ip = Object.values(networkInterfaces)
      .flat()
      .find(iface => !iface?.internal && iface?.family === 'IPv4')?.address || 'unknown';
    
    const public_ip = await getPublicIP();
    log.debug('System info - Public IP:', { public_ip });
    
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'unknown';
    const cpuThreads = cpus.length;
    const cpuUsage = await getCpuUsage();
    const memoryUsage = await getMemoryUsage();
    const diskUsage = await getDiskUsage();
    const uptime = Math.floor(os.uptime());
    const networkTraffic = await getNetworkTraffic();
    const memoryTotal = os.totalmem();
    const diskTotal = await getDiskTotal();

    const systemInfo = {
      hostname,
      ip,
      public_ip,
      cpuModel,
      cpuThreads,
      cpuUsage,
      memoryUsage,
      diskUsage,
      memoryTotal,
      diskTotal,
      uptime,
      networkTraffic
    };

    log.debug('Full system info:', { systemInfo });
    return systemInfo;
  } catch (error) {
    log.error('Error getting system info:', error);
    throw error;
  }
}

// Modify ping functionality
async function ping(target: string, port: number): Promise<number> {
  try {
    // Use tcping command with strict timeout
    const { stdout, stderr } = await execAsync(`tcping -x 1 -w 1 ${target} ${port}`);
    
    // Match response time from tcping output
    const match = stdout.match(/\[open\]\s+(\d+\.\d+)\s*ms/);
    if (match) {
      const latency = parseFloat(match[1]);
      return Math.round(latency * 100) / 100;
    }
    
    // Any other case is considered as packet loss
    return -1;
  } catch (error) {
    // Any error is considered as packet loss
    return -1;
  }
}

// Store last successful connection status
let lastSystemInfo: SystemInfo | null = null;

// Add custom type
interface PingTimer extends NodeJS.Timeout {
  isUpdateTimer?: boolean;
  target?: string;
  port?: number;
}

// Modify timers type
const timers = new Set<PingTimer>();

// Helper function to clear timers
function clearPingTimers() {
  // Clear all ping timers
  for (const timer of timers) {
    if (!timer.isUpdateTimer) {
      clearInterval(timer);
      timers.delete(timer);
    }
  }
  // Reset ping targets array
  currentPingTargets = [];
}

// Separate system info update function
async function updateSystemInfo() {
  try {
    const systemInfo = await getSystemInfo();
    lastSystemInfo = systemInfo;
    socket.emit('systemInfo', systemInfo);
    log.debug('Sent system info', { hostname: systemInfo.hostname });
  } catch (error) {
    log.error('Error updating system info:', error);
  }
}

// Unified data update function
async function updateAllData() {
  try {
    // Update system information only
    await updateSystemInfo();
  } catch (error) {
    log.error('Error in updateAllData:', error);
  }
}

// Add interface for ping schedule
interface PingSchedule {
  target: string;
  port: number;
  interval: number;
  nextPingTime: number;
  startTime: number;
  timer?: NodeJS.Timeout;  // Add timer to track the schedule
}

// Store current ping schedules
let pingSchedules: PingSchedule[] = [];

// Function to execute ping and handle timing
async function executePingWithTiming(schedule: PingSchedule): Promise<void> {
  const now = Date.now();
  const expectedTime = schedule.nextPingTime;
  
  // Calculate packet loss before executing ping
  if (now - expectedTime > Math.min(schedule.interval * 0.1, 500)) { // Reduce tolerance to 10% or 500ms
    // If we're too late for this ping, mark it as lost
    socket.emit('pingResult', {
      latency: -1,
      target: schedule.target,
      port: schedule.port,
      timestamp: expectedTime
    });
    log.debug('Missed ping window', {
      target: schedule.target,
      expectedTime: new Date(expectedTime).toISOString(),
      actualTime: new Date(now).toISOString(),
      delay: now - expectedTime
    });
    return;
  }

  try {
    const startTime = Date.now();
    const latency = await ping(schedule.target, schedule.port);
    const endTime = Date.now();
    const executionTime = endTime - startTime;
    
    // If ping took too long, consider it as packet loss
    if (executionTime > Math.min(schedule.interval * 0.8, schedule.interval - 100)) {
      socket.emit('pingResult', {
        latency: -1,
        target: schedule.target,
        port: schedule.port,
        timestamp: expectedTime
      });
      log.debug('Ping took too long', {
        target: schedule.target,
        executionTime,
        interval: schedule.interval,
        expectedTime: new Date(expectedTime).toISOString()
      });
    } else {
      socket.emit('pingResult', {
        latency: latency,
        target: schedule.target,
        port: schedule.port,
        timestamp: expectedTime
      });
      log.debug('Ping result sent', {
        target: schedule.target,
        latency,
        expectedTime: new Date(expectedTime).toISOString(),
        actualTime: new Date(now).toISOString(),
        executionTime
      });
    }
  } catch (error) {
    socket.emit('pingResult', {
      latency: -1,
      target: schedule.target,
      port: schedule.port,
      timestamp: expectedTime
    });
    log.error('Ping execution error', {
      target: schedule.target,
      error: error instanceof Error ? error.message : String(error),
      expectedTime: new Date(expectedTime).toISOString()
    });
  }
}

// Function to schedule next ping with improved drift compensation
function scheduleNextPing(schedule: PingSchedule) {
  if (schedule.timer) {
    clearTimeout(schedule.timer);
  }

  const now = Date.now();
  const baseTime = schedule.startTime;
  const elapsedTime = now - baseTime;
  const intervalCount = Math.floor(elapsedTime / schedule.interval);
  
  // Calculate the exact next interval based on the start time
  const nextIntervalCount = intervalCount + 1;
  const exactNextTime = baseTime + (nextIntervalCount * schedule.interval);
  
  schedule.nextPingTime = exactNextTime;
  
  // Calculate precise delay
  const delay = Math.max(0, schedule.nextPingTime - now);
  
  // For very small delays, use a more precise timing mechanism
  if (delay < 15) {
    const start = process.hrtime();
    const checkTime = () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const elapsed = (seconds * 1000) + (nanoseconds / 1000000);
      if (elapsed >= delay) {
        executePingWithTiming(schedule).then(() => scheduleNextPing(schedule));
      } else {
        setImmediate(checkTime);
      }
    };
    setImmediate(checkTime);
  } else {
    schedule.timer = setTimeout(async () => {
      const beforeExecution = Date.now();
      const timeoutDrift = beforeExecution - schedule.nextPingTime;
      
      // Log if there's significant drift
      if (Math.abs(timeoutDrift) > 5) {
        log.debug('Timer drift detected', {
          target: schedule.target,
          drift: timeoutDrift,
          scheduledTime: new Date(schedule.nextPingTime).toISOString(),
          actualTime: new Date(beforeExecution).toISOString()
        });
      }
      
      await executePingWithTiming(schedule);
      scheduleNextPing(schedule);
    }, delay);
  }
  
  log.debug('Scheduled next ping', {
    target: schedule.target,
    nextPingTime: new Date(schedule.nextPingTime).toISOString(),
    delay,
    interval: schedule.interval,
    baseTime: new Date(baseTime).toISOString(),
    intervalCount: nextIntervalCount
  });
}

// Helper function to add a single ping target
async function addPingTarget(target: { target: string, port: number, interval: number }): Promise<void> {
  const existingSchedule = pingSchedules.find(s => 
    s.target === target.target && s.port === target.port
  );
  
  if (existingSchedule) {
    if (existingSchedule.interval !== target.interval * 1000) {
      // If interval changed, update it and reset the start time
      existingSchedule.interval = target.interval * 1000;
      existingSchedule.startTime = Date.now();
      existingSchedule.nextPingTime = existingSchedule.startTime;
      scheduleNextPing(existingSchedule);
    }
    return;
  }

  const now = Date.now();
  const schedule: PingSchedule = {
    target: target.target,
    port: target.port,
    interval: target.interval * 1000,
    nextPingTime: now,
    startTime: now
  };
  
  pingSchedules.push(schedule);
  
  // Execute initial ping immediately
  await executePingWithTiming(schedule);
  
  // Schedule next ping exactly one interval from start
  schedule.nextPingTime = schedule.startTime + schedule.interval;
  
  // Use precise scheduling for the first interval
  const delay = schedule.nextPingTime - Date.now();
  if (delay < 15) {
    const start = process.hrtime();
    const checkTime = () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const elapsed = (seconds * 1000) + (nanoseconds / 1000000);
      if (elapsed >= delay) {
        executePingWithTiming(schedule).then(() => scheduleNextPing(schedule));
      } else {
        setImmediate(checkTime);
      }
    };
    setImmediate(checkTime);
  } else {
    schedule.timer = setTimeout(async () => {
      await executePingWithTiming(schedule);
      scheduleNextPing(schedule);
    }, delay);
  }
  
  log.debug('Added new ping schedule', {
    target: target.target,
    port: target.port,
    interval: target.interval,
    startTime: new Date(schedule.startTime).toISOString(),
    nextPingTime: new Date(schedule.nextPingTime).toISOString(),
    firstScheduledPing: new Date(schedule.nextPingTime).toISOString()
  });
}

// Modify ping target update processing
socket.on('updatePingTargets', async (data: { targets: Array<{target: string, port: number, interval: number}> }) => {
  try {
    log.info('Received ping targets update:', { 
      targets: data.targets.map(({ target, port, interval }) => ({ target, port, interval }))
    });
    
    // Find targets to remove
    const targetsToRemove = pingSchedules.filter(schedule => 
      !data.targets.some(t => t.target === schedule.target && t.port === schedule.port)
    );
    
    // Remove old targets
    for (const schedule of targetsToRemove) {
      if (schedule.timer) {
        clearTimeout(schedule.timer);
      }
      pingSchedules = pingSchedules.filter(s => s !== schedule);
      log.debug('Removed ping schedule', {
        target: schedule.target,
        port: schedule.port
      });
    }
    
    // Add or update targets one by one
    for (const target of data.targets) {
      await addPingTarget(target);
    }
  } catch (error) {
    log.error('Error processing ping targets update:', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Modify connection event processing
socket.on('connect', async () => {
  log.info('Connected to server');
  try {
    const systemInfo = lastSystemInfo || await getSystemInfo();
    socket.emit('register', systemInfo);
    log.debug('Sent registration info', { hostname: systemInfo.hostname });
    
    // Set up system info update timer
    const systemInfoTimer = setInterval(updateSystemInfo, 5000);
    (systemInfoTimer as PingTimer).isUpdateTimer = true;
    timers.add(systemInfoTimer);
    
    // Note: Don't set up ping timers here - they will be set up when server sends updatePingTargets
  } catch (error) {
    log.error('Error during connection setup:', error);
  }
});

// Modify disconnection processing
socket.on('disconnect', (reason: string) => {
  log.info('Disconnected from server:', { reason });
  
  // Clear all ping timers
  clearPingTimers();
  
  // If it's a server-initiated disconnection, try to reconnect
  if (reason === 'io server disconnect') {
    socket.connect();
  }
});

socket.on('connect_error', (error: Error) => {
  log.error('Connection error:', { error: error.message });
});

interface IpResponse {
  ip?: string;
}

async function getPublicIP(): Promise<string> {
  try {
    // Use more reliable public IP retrieval service, ordered by reliability
    const services = [
      'https://api.ipify.org?format=json',
      'https://ipinfo.io/json',
      'https://api.ip.sb/ip',
      'https://ifconfig.me/ip'
    ];

    for (const service of services) {
      try {
        log.debug('Attempting to get public IP', { service });
        const response = await axios.get(service, { 
          timeout: 5000,
          headers: {
            'User-Agent': 'curl/7.64.1'  // Use simple User-Agent to avoid being blocked
          }
        });

        if (response.data) {
          let ip: string | null = null;

          if (typeof response.data === 'string') {
            // Handle pure text response (like ip.sb and ifconfig.me)
            ip = response.data.trim();
          } else if (typeof response.data === 'object') {
            // Handle JSON response (like ipify and ipinfo.io)
            const ipData = response.data as IpResponse;
            ip = ipData.ip || null;
          }

          if (ip && ip !== '::1' && ip !== '127.0.0.1' && /^[\d.]+$/.test(ip)) {
            log.debug('Successfully got public IP', { service, ip });
            return ip;
          }
        }
      } catch (err: any) {
        log.warn('Failed to get IP from service', { service, error: err.message });
        continue; // Continue to try next service
      }
    }
    
    log.error('All public IP services failed');
    return 'Unknown';
  } catch (error) {
    log.error('Error getting public IP:', error);
    return 'Unknown';
  }
}

// Add error event handler for socket
socket.on('error', (error: Error) => {
  log.error('Socket error:', error);
});

// Add reconnect event handlers
socket.on('reconnect', (attemptNumber: number) => {
  log.info('Reconnected to server', { attemptNumber });
});

socket.on('reconnect_attempt', (attemptNumber: number) => {
  log.debug('Attempting to reconnect', { attemptNumber });
});

socket.on('reconnect_error', (error: Error) => {
  log.error('Reconnection error:', error);
});

socket.on('reconnect_failed', () => {
  log.error('Failed to reconnect to server');
});

// Add process error handlers
process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception:', error);
  // Give logger time to write before exiting
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: any) => {
  log.error('Unhandled rejection:', reason);
});

// Add graceful shutdown handler
process.on('SIGTERM', async () => {
  log.info('Received SIGTERM signal, starting graceful shutdown');
  try {
    // Clean up logs before shutting down
    await cleanupOldLogs();
    clearPingTimers();
    socket.disconnect();
    // Give time for final logs to be written
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  } catch (error) {
    log.error('Error during shutdown:', error);
    process.exit(1);
  }
}); 