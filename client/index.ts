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

// Store current ping schedules
let pingSchedules: PingSchedule[] = [];

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
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

let lastCpuInfo: CpuInfo | null = null;

async function getCpuUsage(): Promise<number> {
  try {
    const statContent = await fs.promises.readFile('/proc/stat', 'utf8');
    const cpuLine = statContent.split('\n').find(line => line.startsWith('cpu '));
    
    if (!cpuLine) {
      throw new Error('Cannot find CPU stats');
    }

    const values = cpuLine.split(/\s+/).slice(1).map(Number);
    
    if (values.length < 8) {
      throw new Error('Incomplete CPU stats data');
    }

    if (values.some(v => isNaN(v) || v < 0)) {
      throw new Error('Invalid CPU stats values');
    }

    const current: CpuInfo = {
      user: values[0],
      nice: values[1],
      system: values[2],
      idle: values[3],
      iowait: values[4],
      irq: values[5],
      softirq: values[6],
      steal: values[7]
    };

    if (!lastCpuInfo) {
      lastCpuInfo = current;
      // Use precise time interval
      const PRECISE_INTERVAL = 1000; // 精确的1秒
      await new Promise(resolve => setTimeout(resolve, PRECISE_INTERVAL));
      return getCpuUsage();
    }

    const delta = {
      user: current.user - lastCpuInfo.user,
      nice: current.nice - lastCpuInfo.nice,
      system: current.system - lastCpuInfo.system,
      idle: current.idle - lastCpuInfo.idle,
      iowait: current.iowait - lastCpuInfo.iowait,
      irq: current.irq - lastCpuInfo.irq,
      softirq: current.softirq - lastCpuInfo.softirq,
      steal: current.steal - lastCpuInfo.steal
    };

    // Validate delta values
    if (Object.values(delta).some(v => v < 0)) {
      log.warn('CPU counter wrapped or invalid delta detected, resetting stats');
      lastCpuInfo = current;
      return getCpuUsage();
    }

    const totalDelta = Object.values(delta).reduce((acc, val) => acc + val, 0);
    const activeDelta = totalDelta - delta.idle - delta.iowait;
    
    lastCpuInfo = current;

    if (totalDelta === 0) {
      log.warn('No CPU activity detected');
      return 0;
    }

    const cpuUsage = (activeDelta / totalDelta) * 100;
    
    log.debug('CPU usage calculation:', {
      total: totalDelta,
      active: activeDelta,
      idle: delta.idle,
      iowait: delta.iowait,
      usage: cpuUsage.toFixed(2) + '%'
    });

    return Math.min(100, Math.max(0, Math.round(cpuUsage * 100) / 100));

  } catch (error) {
    log.error('Error getting CPU usage:', error);
    return 0;
  }
}

// Get memory usage
async function getMemoryUsage(): Promise<number> {
  try {
    const memContent = await fs.promises.readFile('/proc/meminfo', 'utf8');
    const memInfo: { [key: string]: number } = {};

    memContent.split('\n').forEach(line => {
      const matches = line.match(/^(\w+):\s+(\d+)/);
      if (matches) {
        const value = parseInt(matches[2]);
        if (!isNaN(value) && value >= 0) {
          memInfo[matches[1]] = value;
        }
      }
    });

    const requiredKeys = ['MemTotal', 'MemFree', 'Buffers', 'Cached', 'SReclaimable', 'Shmem'];
    const missingKeys = requiredKeys.filter(key => !(key in memInfo));
    
    if (missingKeys.length > 0) {
      throw new Error(`Missing required memory info: ${missingKeys.join(', ')}`);
    }

    const total = memInfo['MemTotal'];
    
    // Validate total memory size
    if (total <= 0) {
      throw new Error('Invalid total memory size');
    }

    let used: number;
    let usagePercentage: number;

    // 优先使用 MemAvailable 计算（Linux 3.14+ 内核支持）
    if ('MemAvailable' in memInfo && memInfo['MemAvailable'] > 0) {
      used = total - memInfo['MemAvailable'];
      usagePercentage = (used / total) * 100;
      
      log.debug('Memory usage calculation (using MemAvailable):', {
        total: `${total} KB`,
        available: `${memInfo['MemAvailable']} KB`,
        used: `${used} KB`,
        percentage: `${usagePercentage.toFixed(2)}%`
      });
    } else {
      // 回退到传统计算方法
      const free = memInfo['MemFree'];
      const buffers = memInfo['Buffers'];
      const cached = memInfo['Cached'];
      const sReclaimable = memInfo['SReclaimable'];
      const shmem = memInfo['Shmem'];

      used = total - free - buffers - (cached + sReclaimable) + shmem;
      usagePercentage = (used / total) * 100;
      
      log.debug('Memory usage calculation (traditional):', {
        total: `${total} KB`,
        free: `${free} KB`,
        buffers: `${buffers} KB`,
        cached: `${cached} KB`,
        sReclaimable: `${sReclaimable} KB`,
        shmem: `${shmem} KB`,
        used: `${used} KB`,
        percentage: `${usagePercentage.toFixed(2)}%`
      });
    }
    
    // Validate calculation results
    if (used < 0) {
      log.warn('Negative memory usage calculated, possible system inconsistency');
      return 0;
    }
    
    if (used > total) {
      log.warn('Calculated memory usage exceeds total memory, capping at 100%');
      return 100;
    }

    return Math.min(100, Math.max(0, Math.round(usagePercentage * 100) / 100));

  } catch (error) {
    log.error('Error getting memory usage:', error);
    return 0;
  }
}

// Get disk usage
interface DiskUsageInfo {
  usage: number;
  inodeUsage: number;
}

async function getDiskUsage(): Promise<number> {
  try {
    // 获取磁盘空间使用情况
    const { stdout } = await execAsync(
      'df -Pl | grep -vE "^(tmpfs|devtmpfs|udev|none|overlay|shm|snap|squashfs|rootfs|/dev/loop)"'
    );
    
    // 获取inode使用情况
    const { stdout: inodeStdout } = await execAsync(
      'df -iPl | grep -vE "^(tmpfs|devtmpfs|udev|none|overlay|shm|snap|squashfs|rootfs|/dev/loop)"'
    ).catch(err => {
      log.warn('Failed to get inode usage, continuing with space usage only:', err);
      return { stdout: '' };
    });

    const lines = stdout.trim().split('\n');
    const inodeLines = inodeStdout.trim().split('\n');

    if (lines.length <= 1) {
      log.warn('No valid disk partitions found');
      return 0;
    }

    let totalSize = 0;
    let totalUsed = 0;
    let totalInodes = 0;
    let usedInodes = 0;
    const mountPoints: string[] = [];

    // 处理磁盘空间使用情况
    lines.slice(1).forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) {
        log.warn('Invalid df output format:', { line });
        return;
      }

      const size = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const mountPoint = parts[5];

      if (isNaN(size) || isNaN(used) || size <= 0) {
        log.warn('Invalid disk size or usage:', { size, used });
        return;
      }

      if (used > size) {
        log.warn('Used space exceeds total size:', { size, used });
        return;
      }

      totalSize += size;
      totalUsed += used;
      mountPoints.push(mountPoint);
    });

    // 处理inode使用情况
    if (inodeLines.length > 1) {
      inodeLines.slice(1).forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return;

        const inodes = parseInt(parts[1]);
        const usedInodeCount = parseInt(parts[2]);

        if (!isNaN(inodes) && !isNaN(usedInodeCount) && inodes > 0) {
          totalInodes += inodes;
          usedInodes += usedInodeCount;
        }
      });
    }

    if (totalSize === 0) {
      log.warn('No valid disk data found');
      return 0;
    }

    const spaceUsagePercentage = (totalUsed / totalSize) * 100;
    const inodeUsagePercentage = totalInodes > 0 ? (usedInodes / totalInodes) * 100 : 0;

    // 使用空间使用率和inode使用率的较大值
    const finalUsage = Math.max(spaceUsagePercentage, inodeUsagePercentage);
    
    log.debug('Disk usage calculation:', {
      spaceUsage: `${spaceUsagePercentage.toFixed(2)}%`,
      inodeUsage: `${inodeUsagePercentage.toFixed(2)}%`,
      finalUsage: `${finalUsage.toFixed(2)}%`,
      mountPoints: mountPoints.join(', ')
    });
    
    return Math.min(100, Math.max(0, Math.round(finalUsage * 100) / 100));

  } catch (error) {
    log.error('Error getting disk usage:', error);
    return 0;
  }
}

// Get network traffic
async function getNetworkTraffic(): Promise<{ rx: string; tx: string }> {
  try {
    const netData = await fs.promises.readFile('/proc/net/dev', 'utf8');

    let totalRx = 0n;
    let totalTx = 0n;
    const interfaces: string[] = [];

    netData.split('\n').forEach(line => {
      if (line.includes(':')) {
        const [iface, data] = line.split(':');
        const ifaceName = iface.trim();
        
        // Exclude loopback interface and invalid interfaces
        if (!ifaceName.startsWith('lo') && data) {
          try {
            const values = data.trim().split(/\s+/).map(val => BigInt(val));
            if (values.length >= 9) {  // Ensure sufficient values exist
              totalRx += values[0];  // Received bytes
              totalTx += values[8];  // Transmitted bytes
              interfaces.push(ifaceName);
            } else {
              log.warn('Invalid network interface data format:', { interface: ifaceName });
            }
          } catch (err) {
            log.warn('Error parsing network interface data:', { 
              interface: ifaceName, 
              error: err instanceof Error ? err.message : String(err) 
            });
          }
        }
      }
    });

    // Ensure at least one valid interface exists
    if (interfaces.length === 0) {
      log.warn('No valid network interfaces found');
      return { rx: '0 B', tx: '0 B' };
    }

    const formatBytes = (bytes: bigint): string => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let size = Number(bytes);
      let unitIndex = 0;
      
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }

      const decimals = size >= 1 ? 2 : 3;
      return `${size.toFixed(decimals)} ${units[unitIndex]}`;
    };

    const result = {
      rx: formatBytes(totalRx),
      tx: formatBytes(totalTx)
    };

    // Log detailed network traffic information
    log.debug('Network traffic calculation:', {
      interfaces: interfaces.join(', '),
      rx: result.rx,
      tx: result.tx,
      rxRaw: totalRx.toString(),
      txRaw: totalTx.toString()
    });

    return result;
  } catch (error) {
    log.error('Error getting network traffic:', error);
    return { rx: '0 B', tx: '0 B' };
  }
}

// Get total disk size
async function getDiskTotal(): Promise<number> {
  try {
    // 使用与 getDiskUsage 相同的命令和过滤条件
    const { stdout } = await execAsync(
      'df -Pl | grep -vE "^(tmpfs|devtmpfs|udev|none|overlay|shm|snap|squashfs|rootfs|/dev/loop)"'
    );
    
    const lines = stdout.trim().split('\n');
    if (lines.length <= 1) {
      log.warn('No valid disk partitions found');
      return 0;
    }

    let totalSize = 0;
    const filesystems: string[] = [];
    
    // 跳过标题行
    lines.slice(1).forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) {
        log.warn('Invalid df output format:', { line });
        return;
      }

      const filesystem = parts[0];
      const size = parseInt(parts[1]); // 总大小(1K-blocks)
      
      if (!isNaN(size) && size > 0) {
        totalSize += size;
        filesystems.push(filesystem);
      } else {
        log.warn('Invalid disk size:', { filesystem, size });
      }
    });
    
    // 转换为字节(1K-blocks * 1024)
    const totalBytes = totalSize * 1024;
    
    // 记录详细信息
    log.debug('Disk total calculation:', {
      totalSize: `${totalSize} KB`,
      totalBytes: `${totalBytes} bytes`,
      filesystems: filesystems.join(', ')
    });
    
    return totalBytes;

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

// Ping function with timeout control
async function ping(target: string, port: number): Promise<number> {
  return new Promise((resolve) => {
    // Set 1.2s timeout (slightly longer than tcping timeout)
    const timeout = setTimeout(() => {
      resolve(-1);  // Timeout returns -1 indicating packet loss
      log.debug('Ping timeout:', { target, port });
    }, 1200);

    // Execute tcping with proper parameters
    // -n 1: Single attempt
    execAsync(`tcping -n 1 ${target} ${port}`)
      .then(({ stdout, stderr }) => {
        clearTimeout(timeout);
        const output = stdout.trim();
        
        // Debug log for output format analysis
        log.debug('Tcping raw output:', {
          target,
          port,
          stdout: output,
          stderr: stderr.trim()
        });

        // Check for packet loss or errors
        if (output.includes('0 received') || output.includes('100% loss') || stderr.trim()) {
          log.debug('Ping packet loss detected', {
            target,
            port,
            output
          });
          resolve(-1);
          return;
        }

        // Parse latency value from the new format
        // Looking for pattern: "time=X.XXXms"
        const latencyMatch = output.match(/time=(\d+\.\d+)ms/);
        if (latencyMatch && latencyMatch[1]) {
          const latency = parseFloat(latencyMatch[1]);
          if (!isNaN(latency) && latency >= 0 && latency <= 5000) {
            resolve(Math.round(latency * 100) / 100);
          } else {
            log.warn('Invalid latency value:', {
              target,
              port,
              latency,
              output
            });
            resolve(-1);
          }
        } else {
          log.debug('Could not parse latency from output', {
            target,
            port,
            output
          });
          resolve(-1);
        }
      })
      .catch((error) => {
        clearTimeout(timeout);
        log.debug('Ping execution error:', {
          target,
          port,
          error: error instanceof Error ? error.message : String(error)
        });
        resolve(-1);
      });
  });
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
  for (const schedule of pingSchedules) {
    if (schedule.timer) {
      clearTimeout(schedule.timer);
    }
  }
  // Reset ping schedules array
  pingSchedules = [];
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

// Store last successful system info and update time
interface SystemInfoState {
  info: SystemInfo | null;
  lastUpdateTime: number;
}

let systemInfoState: SystemInfoState = {
  info: null,
  lastUpdateTime: 0
};

// Separate system info update function with rate limiting
async function updateSystemInfo() {
  try {
    const now = Date.now();
    // Ensure minimum 2.9s between updates (providing 100ms buffer)
    if (now - systemInfoState.lastUpdateTime < 2900) {
      log.debug('Skipping system info update - too soon', {
        timeSinceLastUpdate: now - systemInfoState.lastUpdateTime
      });
      return;
    }

    const systemInfo = await getSystemInfo();
    systemInfoState = {
      info: systemInfo,
      lastUpdateTime: now
    };
    
    socket.emit('systemInfo', systemInfo);
    log.debug('Sent system info', { 
      hostname: systemInfo.hostname,
      timestamp: new Date(now).toISOString()
    });
  } catch (error) {
    log.error('Error updating system info:', error);
  }
}

// Modify connection event processing
socket.on('connect', async () => {
  log.info('Connected to server');
  try {
    // Send initial system info
    const systemInfo = await getSystemInfo();
    socket.emit('register', systemInfo);
    log.debug('Sent registration info', { hostname: systemInfo.hostname });
    
    // Clear any existing ping schedules
    clearPingTimers();
  } catch (error) {
    log.error('Error during connection setup:', error);
  }
});

// Add handler for system info request
socket.on('requestSystemInfo', async () => {
  try {
    const systemInfo = await getSystemInfo();
    socket.emit('systemInfo', systemInfo);
    log.debug('Sent system info on request', { hostname: systemInfo.hostname });
  } catch (error) {
    log.error('Error sending system info:', error);
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

// Optimized ping execution function
async function executePingWithTiming(schedule: PingSchedule): Promise<void> {
  const now = Date.now();
  const expectedTime = schedule.nextPingTime;
  
  // Adjust max delay based on interval
  // For intervals <= 1s: max delay = 20% of interval
  // For intervals > 1s: max delay = min(500ms, 10% of interval)
  const maxDelay = schedule.interval <= 1000 
    ? schedule.interval * 0.2 
    : Math.min(500, schedule.interval * 0.1);

  // If too late for scheduled time, record as packet loss
  if (now - expectedTime > maxDelay) {
    socket.emit('pingResult', {
      latency: -1,
      target: schedule.target,
      port: schedule.port,
      timestamp: expectedTime,
      type: 'timeout'  // Add type for better tracking
    });
    log.debug('Missed ping window', {
      target: schedule.target,
      expectedTime: new Date(expectedTime).toISOString(),
      actualTime: new Date(now).toISOString(),
      delay: now - expectedTime,
      maxAllowedDelay: maxDelay
    });
    return;
  }

  // Execute ping with timeout
  const startTime = Date.now();
  const latency = await ping(schedule.target, schedule.port);
  const endTime = Date.now();
  const executionTime = endTime - startTime;

  // Dynamic execution time threshold based on interval
  const maxExecutionTime = Math.min(
    schedule.interval * 0.8,  // 80% of interval
    schedule.interval - 100,  // Leave 100ms buffer
    1000  // Hard cap at 1 second
  );

  // If execution time exceeds threshold, record as packet loss
  if (executionTime > maxExecutionTime) {
    socket.emit('pingResult', {
      latency: -1,
      target: schedule.target,
      port: schedule.port,
      timestamp: expectedTime,
      type: 'execution_timeout'  // Add type for better tracking
    });
    log.debug('Ping execution too long', {
      target: schedule.target,
      executionTime,
      maxExecutionTime,
      interval: schedule.interval,
      expectedTime: new Date(expectedTime).toISOString()
    });
    return;
  }

  // Send normal ping result
  socket.emit('pingResult', {
    latency,
    target: schedule.target,
    port: schedule.port,
    timestamp: expectedTime,
    type: latency >= 0 ? 'success' : 'failed'  // Add type for better tracking
  });

  log.debug('Ping result', {
    target: schedule.target,
    latency,
    executionTime,
    expectedTime: new Date(expectedTime).toISOString(),
    actualTime: new Date(now).toISOString()
  });
}

// Optimized scheduling function
function scheduleNextPing(schedule: PingSchedule) {
  if (schedule.timer) {
    clearTimeout(schedule.timer);
  }

  const now = Date.now();
  const baseTime = schedule.startTime;
  const elapsedTime = now - baseTime;
  const intervalCount = Math.floor(elapsedTime / schedule.interval);
  const nextIntervalCount = intervalCount + 1;
  const exactNextTime = baseTime + (nextIntervalCount * schedule.interval);
  
  schedule.nextPingTime = exactNextTime;
  const delay = Math.max(0, schedule.nextPingTime - now);

  // Use more precise timing for very small delays
  if (delay < 15) {
    const start = process.hrtime();
    const checkTime = () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const elapsed = (seconds * 1000) + (nanoseconds / 1000000);
      if (elapsed >= delay) {
        executePingWithTiming(schedule).then(() => {
          // Only schedule next ping if the schedule still exists
          if (pingSchedules.includes(schedule)) {
            scheduleNextPing(schedule);
          }
        });
      } else {
        setImmediate(checkTime);
      }
    };
    setImmediate(checkTime);
  } else {
    schedule.timer = setTimeout(async () => {
      const beforeExecution = Date.now();
      const timeoutDrift = beforeExecution - schedule.nextPingTime;
      
      if (Math.abs(timeoutDrift) > 5) {
        log.debug('Timer drift detected', {
          target: schedule.target,
          drift: timeoutDrift,
          scheduledTime: new Date(schedule.nextPingTime).toISOString(),
          actualTime: new Date(beforeExecution).toISOString()
        });
      }
      
      await executePingWithTiming(schedule);
      // Only schedule next ping if the schedule still exists
      if (pingSchedules.includes(schedule)) {
        scheduleNextPing(schedule);
      }
    }, delay);
  }

  log.debug('Next ping scheduled', {
    target: schedule.target,
    nextPingTime: new Date(schedule.nextPingTime).toISOString(),
    delay,
    interval: schedule.interval
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
    interval: target.interval * 1000, // Convert to milliseconds
    nextPingTime: now,
    startTime: now
  };
  
  pingSchedules.push(schedule);
  
  // Execute initial ping immediately
  await executePingWithTiming(schedule);
  
  // Schedule next ping exactly one interval from start
  schedule.nextPingTime = schedule.startTime + schedule.interval;
  scheduleNextPing(schedule);
  
  log.debug('Added new ping schedule', {
    target: target.target,
    port: target.port,
    interval: target.interval,
    startTime: new Date(schedule.startTime).toISOString(),
    nextPingTime: new Date(schedule.nextPingTime).toISOString()
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