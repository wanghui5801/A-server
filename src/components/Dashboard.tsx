import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import socketIOClient from 'socket.io-client';
import DetailModal from './DetailModal';
import '../styles/animations.css';
import io from 'socket.io-client';

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
  return window.location.origin;
};

// Create a function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
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

// Add this new modal component before the Dashboard component
const EditServiceNameModal = React.memo(({ isOpen, onClose, initialName, onUpdate }: {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  onUpdate: (name: string) => void;
}) => {
  const [serviceName, setServiceName] = useState(initialName);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      onUpdate(serviceName);
      onClose();
    } catch (err) {
      setError('Failed to update service name');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl w-full sm:w-[480px] border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">Edit Service Name</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors duration-300 p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10 group"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative group">
              <input
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="Enter service name"
                className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-400/10 px-4 py-2.5 rounded-lg border border-red-400/20 animate-shake">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </span>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors duration-300 rounded-lg hover:bg-gray-800/50 backdrop-blur-sm border border-gray-800/10"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-500/90 text-white rounded-lg hover:bg-blue-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-blue-400/20"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Updating...
                  </span>
                ) : (
                  'Update Name'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

const getUsageColor = (usage: number, type: 'cpu' | 'memory' | 'disk') => {
  if (usage === undefined || usage === null) return 'bg-slate-500/15 hover:bg-slate-500/20 transition-all duration-300';
  
  // CPU colors - Using green to red gradient with hover effects
  if (type === 'cpu') {
    if (usage >= 90) return 'bg-[#EF4444]/30 hover:bg-[#EF4444]/40 transition-all duration-300'; // Red for critical
    if (usage >= 70) return 'bg-[#F97316]/25 hover:bg-[#F97316]/35 transition-all duration-300'; // Orange for warning
    if (usage >= 50) return 'bg-[#FBBF24]/20 hover:bg-[#FBBF24]/30 transition-all duration-300'; // Yellow for moderate
    return 'bg-[#22C55E]/20 hover:bg-[#22C55E]/30 transition-all duration-300'; // Green for normal
  }
  
  // Memory colors - Using same green to red gradient with slightly different thresholds
  if (type === 'memory') {
    if (usage >= 85) return 'bg-[#EF4444]/30 hover:bg-[#EF4444]/40 transition-all duration-300'; // Red for critical
    if (usage >= 70) return 'bg-[#F97316]/25 hover:bg-[#F97316]/35 transition-all duration-300'; // Orange for warning
    if (usage >= 55) return 'bg-[#FBBF24]/20 hover:bg-[#FBBF24]/30 transition-all duration-300'; // Yellow for moderate
    return 'bg-[#22C55E]/20 hover:bg-[#22C55E]/30 transition-all duration-300'; // Green for normal
  }
  
  // Disk colors - Using same scheme but with higher thresholds
  if (type === 'disk') {
    if (usage >= 90) return 'bg-[#EF4444]/30 hover:bg-[#EF4444]/40 transition-all duration-300'; // Red for critical
    if (usage >= 75) return 'bg-[#F97316]/25 hover:bg-[#F97316]/35 transition-all duration-300'; // Orange for warning
    if (usage >= 60) return 'bg-[#FBBF24]/20 hover:bg-[#FBBF24]/30 transition-all duration-300'; // Yellow for moderate
    return 'bg-[#22C55E]/20 hover:bg-[#22C55E]/30 transition-all duration-300'; // Green for normal
  }
  
  return 'bg-slate-500/15 hover:bg-slate-500/20 transition-all duration-300';
};

const getStatusColor = (client: Client) => {
  switch (client.status) {
    case 'down':
      return 'bg-[#EF4444]/90 text-white shadow-sm shadow-[#EF4444]/20 hover:shadow-[#EF4444]/30 hover:bg-[#EF4444]/80 transition-all duration-300'; // Red
    case 'pending':
      return 'bg-[#FBBF24]/90 text-white shadow-sm shadow-[#FBBF24]/20 hover:shadow-[#FBBF24]/30 hover:bg-[#FBBF24]/80 transition-all duration-300'; // Yellow
    case 'online':
      return 'bg-[#22C55E]/90 text-white shadow-sm shadow-[#22C55E]/20 hover:shadow-[#22C55E]/30 hover:bg-[#22C55E]/80 transition-all duration-300'; // Green
    default:
      return 'bg-slate-500/90 text-white shadow-sm hover:shadow-md transition-all duration-300';
  }
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
  const [isEditNameModalOpen, setIsEditNameModalOpen] = useState(false);
  const [serviceName, setServiceName] = useState<string>('Services');
  const socketRef = useRef<any>(null);

  // Replace localStorage effect with API call
  useEffect(() => {
    const fetchServiceName = async () => {
      try {
        const response = await fetch(`${getApiUrl()}/api/service-name`);
        if (!response.ok) {
          throw new Error('Failed to fetch service name');
        }
        const data = await response.json();
        setServiceName(data.name);
      } catch (error) {
        console.error('Error fetching service name:', error);
      }
    };

    fetchServiceName();
  }, []);

  // Replace handleServiceNameUpdate with API call
  const handleServiceNameUpdate = useCallback(async (newName: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/service-name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        throw new Error('Failed to update service name');
      }

      setServiceName(newName);
    } catch (error) {
      console.error('Error updating service name:', error);
      // Optionally show error to user
      setError('Failed to update service name');
    }
  }, []);

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

  // Replace debouncedFetchClients with simpler version
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

  // Initialize socket connection
  useEffect(() => {
    const newSocket = socketIOClient(getSocketUrl(), {
      transports: ['websocket'],
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000
    });

    socketRef.current = newSocket;

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Set up socket event listeners
  useEffect(() => {
    if (!socketRef.current) return;

    const socket = socketRef.current;

    socket.on('connect', () => {
      setConnected(true);
      debouncedFetchClients();
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('systemInfoUpdate', () => {
      debouncedFetchClients();
    });

    socket.on('systemInfo', (data: any) => {
      setClients(prevClients => {
        const index = prevClients.findIndex(c => c.hostname === data.hostname);
        if (index === -1) {
          return [...prevClients, { ...data, lastSeen: new Date().toISOString() }];
        }
        const newClients = [...prevClients];
        newClients[index] = { ...newClients[index], ...data, lastSeen: new Date().toISOString() };
        return sortClients(newClients);
      });
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('systemInfoUpdate');
      socket.off('systemInfo');
    };
  }, [debouncedFetchClients, sortClients]);

  // Fetch initial data and set up ping config updates
  useEffect(() => {
    debouncedFetchClients();
    fetchPingConfigs();

    const configInterval = setInterval(fetchPingConfigs, 30000);

    return () => {
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
        <svg className="w-10 sm:w-12 h-10 sm:h-12 loading-spinner text-green-500/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path className="loading-track opacity-20" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
          <path className="opacity-90" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
            <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
          </path>
        </svg>
      </div>
      <div className="mt-4 sm:mt-5 text-gray-300 text-sm sm:text-base font-medium loading-pulse tracking-wide">
        Loading services...
      </div>
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
    <div className="min-h-screen bg-[#1C1C1C] text-white p-2 sm:p-8">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 py-6 sm:py-12 animate-fade-in">
        {/* Header Section */}
        <div className="mb-6 sm:mb-8 px-2">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center group">
                <button
                  onClick={() => setIsEditNameModalOpen(true)}
                  className="relative mr-3 sm:mr-4 focus:outline-none"
                >
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-gray-300/90 transition-transform duration-300 group-hover:scale-105 cursor-pointer" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                      d="M6.5 12h2l2-6 3 18 2.5-12h2" />
                    <path strokeLinecap="round" strokeWidth={1.5}
                      d="M3 12h2M19 12h2" />
                    <path strokeLinecap="round" strokeWidth={1.5} opacity="0.5"
                      d="M1 12h1M22 12h1" />
                    <circle cx="12" cy="12" r="9" strokeWidth={1.5} opacity="0.2" className="animate-pulse" />
                    <circle cx="12" cy="12" r="5" strokeWidth={1.5} opacity="0.3" />
                  </svg>
                </button>
                <h1 className="text-2xl sm:text-4xl font-medium tracking-tight text-gray-200 transition-colors duration-300 group-hover:text-gray-100">{serviceName}</h1>
              </div>
              <a
                href="/admin"
                className="flex items-center justify-center px-3.5 sm:px-4 py-2 sm:py-2.5 bg-gray-700/80 text-white rounded-lg hover:bg-gray-600/90 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 backdrop-blur-sm text-sm sm:text-base font-medium tracking-wide border border-gray-600/10 group"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2 transition-transform duration-300 group-hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="relative">Manage</span>
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
        <div className="space-y-3 px-2">
          {clients.map((client, index) => (
            <div
              key={`${client.hostname}-${client.id}`}
              onClick={() => handleClientSelect(client)}
              className="bg-[#1E1E1E] rounded-xl p-4 sm:p-5 cursor-pointer hover:bg-[#252525] transition-all duration-300 group transform hover:scale-[1.01] hover:shadow-xl animate-fade-in backdrop-blur-sm border border-gray-800/10"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Mobile Layout */}
              <div className="sm:hidden">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`
                        inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium tracking-wide whitespace-nowrap
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
                          className="h-4 w-auto rounded object-contain transition-transform duration-300 group-hover:scale-110"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* System Info and Uptime with enhanced styling */}
                  <div className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-[#252525] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-300 border border-gray-800/20 shadow-sm group-hover:bg-[#2a2a2a] transition-all duration-300 hover:shadow-md">
                        <svg className="w-3.5 h-3.5 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                        <span className="text-gray-400 group-hover:text-gray-300 transition-colors duration-300">
                          {client.cpuThreads || 0}C·{Math.round((client.memoryTotal || 0) / (1024 * 1024 * 1024))}G·
                          {Math.round((client.diskTotal || 0) / (1024 * 1024 * 1024))}G
                        </span>
                      </div>
                      <div className="flex items-center bg-[#252525] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-300 border border-gray-800/20 shadow-sm group-hover:bg-[#2a2a2a] transition-all duration-300 hover:shadow-md">
                        <svg className="w-3.5 h-3.5 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-gray-400 group-hover:text-gray-300 transition-colors duration-300">
                          {(() => {
                            const uptime = client.uptime || 0;
                            const days = Math.floor(uptime / 86400);
                            const hours = Math.floor((uptime % 86400) / 3600);
                            const minutes = Math.floor((uptime % 3600) / 60);
                            
                            if (days > 0) return `${days}d ${hours}h`;
                            if (hours > 0) return `${hours}h ${minutes}m`;
                            return `${minutes}m`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {[
                      { value: client.cpuUsage, label: 'CPU', type: 'cpu' },
                      { value: client.memoryUsage, label: 'MEM', type: 'memory' },
                      { value: client.diskUsage, label: 'DSK', type: 'disk' }
                    ].map((item, index) => (
                      <div key={index} className="w-full">
                        <div className="flex items-center bg-[#252525] rounded-lg px-2.5 py-1 relative overflow-hidden group-hover:bg-[#2a2a2a] transition-colors shadow-sm">
                          <div 
                            className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                              client.status === 'down' ? 'bg-red-500/20' : 
                              client.status === 'pending' ? 'bg-yellow-500/20' : 
                              getUsageColor(item.value, item.type as 'cpu' | 'memory' | 'disk')
                            }`}
                            style={{ width: `${Math.min(Number(item.value || 0), 100)}%` }}
                          />
                          <div className="flex items-center justify-between w-full relative z-10">
                            <span className="text-gray-400 text-xs font-medium">{item.label}</span>
                            <span className="text-gray-300 text-xs font-medium group-hover:text-white transition-colors">{(item.value || 0).toFixed(1)}%</span>
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
                    px-3 py-1.5 rounded-md text-sm font-medium min-w-[70px] text-center
                    transition-all duration-500 ease-in-out transform hover:scale-105
                    ${getStatusColor(client)}
                    shadow-sm backdrop-blur-sm hover:shadow-md
                  `}>
                    {getStatusText(client)}
                  </div>
                  <span className="text-gray-300 font-medium group-hover:text-white transition-all duration-300 ease-in-out">
                    {client.hostname || 'Unknown'}
                  </span>
                </div>

                <div className="flex items-center">
                  <div className="flex items-center justify-center w-32 transition-transform duration-300">
                    {client.countryCode && (
                      <div className="flex items-center group/flag">
                        <img
                          src={`https://cdn.jsdelivr.net/gh/xykt/ISO3166@main/flags/svg/${client.countryCode.toLowerCase()}.svg`}
                          alt={`Flag of ${client.countryCode}`}
                          className="h-5 w-auto rounded object-contain transition-all duration-300 transform group-hover/flag:scale-110 hover:shadow-lg"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const textElement = target.nextElementSibling as HTMLElement;
                            if (textElement) {
                              textElement.classList.remove('hidden');
                            }
                          }}
                        />
                        <span className="text-xs text-gray-500 ml-2 hidden group-hover/flag:text-gray-400 transition-all duration-300 opacity-0 group-hover/flag:opacity-100">
                          {client.countryCode.toLowerCase()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="flex items-center group/metric">
                      <span className="text-xs text-gray-500 inline-block w-8 group-hover/metric:text-gray-400 transition-all duration-300 font-medium">CPU</span>
                      <div className="bg-[#252525] rounded-lg px-3 py-1 w-[70px] text-center relative overflow-hidden ml-1.5 group-hover/metric:bg-[#2a2a2a] transition-all duration-300 shadow-sm hover:shadow-md">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ease-out ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            getUsageColor(client.cpuUsage, 'cpu')
                          }`}
                          style={{ 
                            width: `${Math.min(Number(client.cpuUsage || 0), 100)}%`,
                            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover/metric:text-white transition-all duration-300 font-medium transform group-hover/metric:scale-105">
                          {(client.cpuUsage || 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center group/metric">
                      <span className="text-xs text-gray-500 inline-block w-14 group-hover/metric:text-gray-400 transition-all duration-300 font-medium">Memory</span>
                      <div className="bg-[#252525] rounded-lg px-3 py-1 w-[70px] text-center relative overflow-hidden ml-1.5 group-hover/metric:bg-[#2a2a2a] transition-all duration-300 shadow-sm hover:shadow-md">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ease-out ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            getUsageColor(client.memoryUsage, 'memory')
                          }`}
                          style={{ 
                            width: `${Math.min(Number(client.memoryUsage || 0), 100)}%`,
                            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover/metric:text-white transition-all duration-300 font-medium transform group-hover/metric:scale-105">
                          {(client.memoryUsage || 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center group/metric">
                      <span className="text-xs text-gray-500 inline-block w-8 group-hover/metric:text-gray-400 transition-all duration-300 font-medium">Disk</span>
                      <div className="bg-[#252525] rounded-lg px-3 py-1 w-[70px] text-center relative overflow-hidden ml-1.5 group-hover/metric:bg-[#2a2a2a] transition-all duration-300 shadow-sm hover:shadow-md">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ease-out ${
                            client.status === 'down' ? 'bg-red-500/20' : 
                            client.status === 'pending' ? 'bg-yellow-500/20' : 
                            getUsageColor(client.diskUsage, 'disk')
                          }`}
                          style={{ 
                            width: `${Math.min(Number(client.diskUsage || 0), 100)}%`,
                            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        />
                        <span className="text-xs text-gray-300 relative z-10 group-hover/metric:text-white transition-all duration-300 font-medium transform group-hover/metric:scale-105">
                          {(client.diskUsage || 0).toFixed(1)}%
                        </span>
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

      {/* Render modal outside the main content */}
      {isEditNameModalOpen && (
        <div className="fixed inset-0 w-screen h-screen" style={{ zIndex: 9999 }}>
          <EditServiceNameModal
            isOpen={isEditNameModalOpen}
            onClose={() => setIsEditNameModalOpen(false)}
            initialName={serviceName}
            onUpdate={handleServiceNameUpdate}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(Dashboard); 