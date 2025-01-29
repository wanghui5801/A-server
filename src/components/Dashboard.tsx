import React, { useState, useEffect, useCallback, useMemo } from 'react';
import socketIOClient from 'socket.io-client';
import DetailModal from './DetailModal';
import '../styles/animations.css';

interface Client {
  id: string;
  hostname: string;
  ip: string;
  lastSeen: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  isRunning?: boolean;
  status?: 'pending' | 'online' | 'down';
  cpuModel?: string;
  cpuThreads?: number;
  memoryTotal?: number;
  diskTotal?: number;
  uptime?: number;
  networkTraffic?: {
    rx: string;
    tx: string;
  };
  networkRx?: string;
  networkTx?: string;
  pingLatency?: number;
  pingTimestamp?: number;
  pingTarget?: string;
  pingData?: {
    latency: number;
    timestamp: number;
    target: string;
  };
  ping_history?: Array<{
    timestamp: number;
    latency: number;
    target: string;
  }>;
  countryCode?: string;
  tags?: string[];
  sort_order?: number;
  created_at?: string;
}

interface PingConfig {
  id: number;
  target: string;
  display_name: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

// Create a function to get socket URL
const getSocketUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = '3000'; // Backend server port
  return `${protocol}//${hostname}:${port}`;
};

// Create a function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = '3000'; // Backend server port
  return `${protocol}//${hostname}:${port}`;
};

// Create socket connection
let socket: any;

if (typeof window !== 'undefined') {
  socket = socketIOClient(getSocketUrl(), {
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    forceNew: true,
    path: '/socket.io'
  });
}

const formatNetworkTraffic = (traffic: string | undefined) => {
  if (!traffic || traffic === 'Unknown') return 'Unknown';
  if (/^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$/.test(traffic)) {
    return traffic;
  }
  const num = parseFloat(traffic);
  if (isNaN(num)) return traffic;
  
  if (num >= 1024 * 1024 * 1024) {
    return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (num >= 1024 * 1024) {
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  } else if (num >= 1024) {
    return `${(num / 1024).toFixed(2)} KB`;
  }
  return `${num.toFixed(2)} B`;
};

const Dashboard: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [pingConfigs, setPingConfigs] = useState<PingConfig[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [isLoading, setIsLoading] = useState(false);

  const checkClientStatus = useCallback((client: Client) => {
    return client.cpuUsage !== undefined || 
           client.memoryUsage !== undefined || 
           client.diskUsage !== undefined;
  }, []);

  const getStatusText = useCallback((client: Client) => {
    if (client.status === 'pending') return 'Pending';
    if (client.status === 'down') return 'Down';
    return 'Online';
  }, []);

  const getStatusColor = useCallback((client: Client) => {
    if (client.status === 'pending') return 'bg-yellow-500 text-black';
    if (client.status === 'down') return 'bg-red-500 text-white';
    return 'bg-[#4CAF50] text-black';
  }, []);

  const sortClients = useCallback((clientsToSort: Client[]) => {
    return [...clientsToSort].sort((a: Client, b: Client) => {
      const aOrder = a.sort_order ?? 0;
      const bOrder = b.sort_order ?? 0;
      if (bOrder !== aOrder) {
        return bOrder - aOrder;
      }
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aDate - bDate;
    });
  }, []);

  const processClientData = useCallback((client: Client, previousClient?: Client) => {
    const baseClient = {
      id: client.id || `pending-${client.hostname}`,
      hostname: client.hostname,
      ip: client.ip || null,
      lastSeen: client.lastSeen || null,
      status: client.status || 'pending',
      countryCode: client.countryCode || null,
      ping_history: Array.isArray(client.ping_history) ? client.ping_history : [],
      cpuThreads: client.cpuThreads || previousClient?.cpuThreads || 0,
      memoryTotal: client.memoryTotal || previousClient?.memoryTotal || 0,
      diskTotal: client.diskTotal || previousClient?.diskTotal || 0,
      tags: client.tags || previousClient?.tags || [],
      sort_order: typeof client.sort_order === 'number' ? client.sort_order : (previousClient?.sort_order || 0)
    };

    if (client.status === 'pending') {
      return {
        ...baseClient,
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkTraffic: { rx: 'Unknown', tx: 'Unknown' },
        pingData: { latency: 0, timestamp: 0, target: '' }
      };
    }

    const networkTraffic = {
      rx: formatNetworkTraffic(client.networkTraffic?.rx || client.networkRx),
      tx: formatNetworkTraffic(client.networkTraffic?.tx || client.networkTx)
    };

    return {
      ...baseClient,
      cpuUsage: client.cpuUsage || 0,
      memoryUsage: client.memoryUsage || 0,
      diskUsage: client.diskUsage || 0,
      networkTraffic,
      cpuModel: client.cpuModel || previousClient?.cpuModel,
      uptime: client.uptime || 0
    };
  }, []);

  // Get Ping configurations
  const fetchPingConfigs = useCallback(async () => {
    if (!connected) return;
    
    try {
      const response = await fetch(`${getApiUrl()}/api/ping-config`);
      if (!response.ok) throw new Error('Failed to fetch ping configs');
      const data = await response.json();
      setPingConfigs(data);
    } catch (error) {
      console.error('Error fetching ping configs:', error);
      setError('Failed to fetch ping configs');
    }
  }, [connected]);

  const debouncedFetchClients = useCallback(
    (() => {
      let timeoutId: NodeJS.Timeout;
      return () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(async () => {
          try {
            const response = await fetch(`${getApiUrl()}/api/clients`, {
              headers: {
                'X-Internal-Request': 'true'
              }
            });
            if (!response.ok) {
              throw new Error('Failed to fetch clients');
            }
            const data = await response.json();
            
            const clientsWithStatus = data.map((client: Client) => {
              const previousClient = clients.find(c => c.hostname === client.hostname);
              return processClientData(client, previousClient);
            });
            
            const sortedClients = sortClients(clientsWithStatus);
            setClients(sortedClients);
            setLoading(false);
            setError('');
            setLastUpdate(Date.now());
          } catch (err) {
            console.error('Error fetching clients:', err);
            setError('Failed to fetch clients');
            setLoading(false);
          }
        }, 300);
      };
    })(),
    [clients, processClientData, sortClients]
  );

  // Initialize socket event listeners when component mounts
  useEffect(() => {
    if (typeof window === 'undefined' || !socket) return;

    const handleSocketEvents = () => {
    const handleConnect = () => {
        console.log('Socket connected successfully');
      setConnected(true);
      setError('');
        debouncedFetchClients();
        fetchPingConfigs(); // Get ping configs after successful connection
    };

    const handleDisconnect = (reason: string) => {
        console.log('Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        socket.connect();
      }
        setConnected(false);
        setError('Disconnected from server, attempting to reconnect...');
    };

    const handleConnectError = (err: Error) => {
        console.error('Socket connection error:', err);
        setError('Failed to connect to server, attempting to reconnect...');
      setConnected(false);
    };

    const handleError = (err: Error) => {
        console.error('Socket error:', err);
        setError('Connection error, attempting to reconnect...');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('error', handleError);

    };
    };

    return handleSocketEvents();
  }, [debouncedFetchClients, fetchPingConfigs]);

  // Add periodic updates as backup
  useEffect(() => {
    // Get initial data immediately
    debouncedFetchClients();
    fetchPingConfigs();

    // Set update interval (update client data every 3 seconds)
    const clientsInterval = setInterval(debouncedFetchClients, 3000);
    
    // Set longer interval for config updates (every 30 seconds)
    const configInterval = setInterval(fetchPingConfigs, 30000);

    return () => {
      clearInterval(clientsInterval);
      clearInterval(configInterval);
    };
  }, [debouncedFetchClients, fetchPingConfigs]);

  // Handle client selection
  const handleClientSelect = useCallback((client: Client) => {
    setSelectedClient(client);
  }, []);

  // Use useMemo to optimize loading state rendering
  const loadingComponent = useMemo(() => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1C1C1C]">
      <div className="relative">
        <svg className="w-12 h-12 loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path className="loading-track text-green-500" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
          <path className="text-green-500" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
            <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
          </path>
        </svg>
      </div>
      <div className="mt-4 text-gray-400 text-sm font-medium loading-pulse">Loading</div>
    </div>
  ), []);

  // Use useMemo to cache client data
  const memoizedClients = useMemo(() => {
    return clients;
  }, [clients]);

  useEffect(() => {
    if (connected) {
      debouncedFetchClients();
    }
  }, [connected, debouncedFetchClients]);

  // Add data update interval check
  useEffect(() => {
    const now = Date.now();
    if (connected && now - lastUpdate > 10000) {
      debouncedFetchClients();
    }
  }, [connected, lastUpdate, debouncedFetchClients]);

  useEffect(() => {
    fetchPingConfigs();
  }, [fetchPingConfigs]);

  if (loading) {
    return loadingComponent;
  }

  return (
    <div className="min-h-screen bg-[#1C1C1C]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12 animate-fade-in">
        {/* Header Section */}
        <div className="mb-8 sm:mb-12">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-gray-300 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                    d="M6.5 12h2l2-6 3 18 2.5-12h2" />
                  <path strokeLinecap="round" strokeWidth={1.5}
                    d="M3 12h2M19 12h2" />
                  <path strokeLinecap="round" strokeWidth={1.5} opacity="0.5"
                    d="M1 12h1M22 12h1" />
                  <circle cx="12" cy="12" r="9" strokeWidth={1.5} opacity="0.2" />
                  <circle cx="12" cy="12" r="5" strokeWidth={1.5} opacity="0.4" />
                </svg>
                <h1 className="text-2xl sm:text-4xl font-medium tracking-tight text-gray-300 animate-slide-down">Services</h1>
              </div>
              <a
                href="/admin"
                className="flex items-center justify-center px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-700/80 text-white rounded-lg hover:bg-gray-600 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 backdrop-blur-sm text-sm sm:text-base font-medium tracking-wide"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage
              </a>
            </div>

            {error && (
              <div className="text-sm text-red-400 animate-shake font-medium tracking-wide">
                <span className="flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {error}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Servers List */}
        <div className="space-y-4">
          {clients.map((client, index) => (
            <div
              key={`${client.hostname}-${client.id}`}
              onClick={() => handleClientSelect(client)}
              className="bg-[#1E1E1E] rounded-lg p-4 sm:p-5 cursor-pointer hover:bg-[#252525] transition-all duration-300 group transform hover:scale-[1.01] hover:shadow-xl animate-fade-in backdrop-blur-sm border border-gray-800/10"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Mobile Layout */}
              <div className="sm:hidden">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`
                        inline-flex items-center px-2 py-1 rounded text-xs font-medium tracking-wide whitespace-nowrap
                        ${getStatusColor(client)}
                        shadow-sm backdrop-blur-sm
                      `}>
                        {getStatusText(client)}
                      </div>
                      <span className="text-gray-300 font-medium text-sm tracking-wide group-hover:text-white transition-colors duration-300 truncate">
                        {client.hostname || 'Unknown'}
                      </span>
                    </div>

                    {client.countryCode && (
                      <div className="flex items-center">
                        <img
                          src={`https://cdn.jsdelivr.net/gh/xykt/ISO3166@main/flags/svg/${client.countryCode.toLowerCase()}.svg`}
                          alt={`Flag of ${client.countryCode}`}
                          className="h-4 w-auto rounded object-contain"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {[
                      { value: client.cpuUsage, bg: 'bg-blue-500/20', label: 'CPU' },
                      { value: client.memoryUsage, bg: 'bg-green-500/20', label: 'MEM' },
                      { value: client.diskUsage, bg: 'bg-yellow-500/20', label: 'DSK' }
                    ].map((item, index) => (
                      <div key={index} className="w-full">
                        <div className="flex items-center bg-[#252525] rounded px-2 py-1 relative overflow-hidden">
                          <div 
                            className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                              client.status === 'down' ? 'bg-red-500/20' : 
                              client.status === 'pending' ? 'bg-yellow-500/20' : 
                              item.bg
                            }`}
                            style={{ width: `${Math.min(Number(item.value || 0), 100)}%` }}
                          />
                          <div className="flex items-center justify-between w-full relative z-10">
                            <span className="text-gray-400 text-xs">{item.label}</span>
                            <span className="text-gray-300 text-xs">{(item.value || 0).toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Desktop Layout */}
              <div className="hidden sm:flex sm:items-center sm:justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`
                    px-2.5 py-1 rounded text-sm font-medium min-w-[60px] text-center transition-all duration-300
                    ${getStatusColor(client)}
                    shadow-sm hover:shadow-md backdrop-blur-sm
                  `}>
                    {getStatusText(client)}
                  </div>
                  <span className="text-gray-300 font-medium group-hover:text-white transition-colors duration-300">
                    {client.hostname || 'Unknown'}
                  </span>
                </div>

                <div className="flex items-center">
                  <div className="flex items-center justify-center w-32">
                    {client.countryCode && (
                      <div className="flex items-center">
                        <img
                          src={`https://cdn.jsdelivr.net/gh/xykt/ISO3166@main/flags/svg/${client.countryCode.toLowerCase()}.svg`}
                          alt={`Flag of ${client.countryCode}`}
                          className="h-5 w-auto rounded object-contain transition-transform duration-300 group-hover:scale-110 hover:shadow-lg"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const textElement = target.nextElementSibling as HTMLElement;
                            if (textElement) {
                              textElement.classList.remove('hidden');
                            }
                          }}
                        />
                        <span className="text-xs text-gray-500 ml-2 hidden group-hover:text-gray-400 transition-colors duration-300">
                          {client.countryCode.toLowerCase()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="flex items-center">
                      <span className="text-xs text-gray-500 inline-block w-8 group-hover:text-gray-400 transition-colors">CPU</span>
                      <div className="bg-[#252525] rounded-md px-3 py-0.5 w-[70px] text-center relative overflow-hidden ml-1 group-hover:bg-[#2a2a2a] transition-colors">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            'bg-green-500/20'
                          }`}
                          style={{ width: `${Math.min(Number(client.cpuUsage || 0), 100)}%` }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover:text-white transition-colors">{(client.cpuUsage || 0).toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs text-gray-500 inline-block w-14 group-hover:text-gray-400 transition-colors">Memory</span>
                      <div className="bg-[#252525] rounded-md px-3 py-0.5 w-[70px] text-center relative overflow-hidden ml-1 group-hover:bg-[#2a2a2a] transition-colors">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            'bg-green-500/20'
                          }`}
                          style={{ width: `${Math.min(Number(client.memoryUsage || 0), 100)}%` }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover:text-white transition-colors">{(client.memoryUsage || 0).toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="text-xs text-gray-500 inline-block w-8 group-hover:text-gray-400 transition-colors">Disk</span>
                      <div className="bg-[#252525] rounded-md px-3 py-0.5 w-[70px] text-center relative overflow-hidden ml-1 group-hover:bg-[#2a2a2a] transition-colors">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            'bg-green-500/20'
                          }`}
                          style={{ width: `${Math.min(Number(client.diskUsage || 0), 100)}%` }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover:text-white transition-colors">{(client.diskUsage || 0).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedClient && (
        <DetailModal
          client={selectedClient}
          onClose={() => {
            console.log('Closing modal, client data:', selectedClient);
            setSelectedClient(null);
          }}
          pingConfigs={pingConfigs}
        />
      )}
    </div>
  );
};

export default React.memo(Dashboard); 