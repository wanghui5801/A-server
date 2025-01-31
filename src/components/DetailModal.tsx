import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  TimeScale,
  Chart as ChartJS
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { zhCN } from 'date-fns/locale';
import 'chart.js/auto';
import '../styles/animations.css';
import '../styles/scrollbar.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  TimeScale
);

// Create a function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
};

interface Client {
  id: string;
  hostname: string;
  ip: string | null;
  lastSeen: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  status?: 'pending' | 'online' | 'down';
  cpuModel?: string | null;
  cpuThreads?: number;
  memoryTotal?: number;
  diskTotal?: number;
  uptime?: number;
  networkTraffic?: {
    rx: string;
    tx: string;
  };
  ping_history?: Array<{
    timestamp: number;
    latency: number;
    target: string;
  }>;
  tags?: string[];
}

interface PingConfig {
  id: number;
  target: string;
  display_name: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

interface DetailModalProps {
  client: Client;
  onClose: () => void;
  pingConfigs?: PingConfig[];
}

const DetailModal: React.FC<DetailModalProps> = React.memo(({ client, onClose, pingConfigs: initialPingConfigs = [] }) => {
  const [chartData, setChartData] = useState<any>(null);
  const [localClient, setLocalClient] = useState<Client>(client);
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [targets, setTargets] = useState<string[]>([]);
  const [pingConfigs, setPingConfigs] = useState<PingConfig[]>(initialPingConfigs);

  // Sort targets based on ping config creation time
  useEffect(() => {
    if (pingConfigs.length > 0) {
      const sortedTargets = pingConfigs
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(config => config.target);
      setTargets(sortedTargets);
    }
  }, [pingConfigs]);

  // Simplified color mapping
  const defaultColor = 'rgb(72, 199, 142)';
  const getColorForTarget = useCallback(() => defaultColor, []);
  const getBackgroundColorForTarget = useCallback(() => defaultColor.replace('rgb', 'rgba').replace(')', ', 0.1)'), []);

  // Optimized chart configuration
  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    hover: {
      intersect: false,
      mode: 'nearest'
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    },
    elements: {
      point: {
        radius: 0,
        hoverRadius: 3,
        hitRadius: 10
      },
      line: {
        tension: 0.35,
        borderWidth: 1.5
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: 'minute',
          displayFormats: {
            minute: 'HH:mm',
            hour: 'HH:mm'
          },
          stepSize: window.innerWidth < 768 ? 120 : 60 // Increase time step on mobile
        },
        adapters: {
          date: {
            locale: zhCN
          }
        },
        grid: {
          display: true,
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          maxRotation: window.innerWidth < 768 ? 45 : 0, // Allow label rotation on mobile
          autoSkip: true,
          maxTicksLimit: window.innerWidth < 768 ? 6 : 12, // Reduce label count on mobile
          color: '#9CA3AF',
          padding: 8,
          font: {
            size: window.innerWidth < 768 ? 10 : 11 // Reduce font size on mobile
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          display: true,
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: '#9CA3AF',
          padding: 8,
          callback: (value: string | number) => {
            const num = Number(value);
            return `${num < 1 ? num.toFixed(1) : Math.round(num)}ms`;
          },
          font: {
            size: window.innerWidth < 768 ? 10 : 11
          },
          stepSize: Math.ceil(Math.max(...(chartData?.datasets[0]?.data?.map((point: any) => point.y) || [0])) / 6)
        }
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'nearest',
        intersect: false,
        backgroundColor: 'rgba(30, 30, 30, 0.9)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgba(72, 199, 142, 0.3)',
        borderWidth: 1,
        padding: 8,
        displayColors: false,
        callbacks: {
          title: (tooltipItems) => {
            const date = new Date(tooltipItems[0].parsed.x);
            return date.toLocaleString('en-US', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          },
          label: (context) => `Latency: ${context.parsed.y.toFixed(1)}ms`
        }
      }
    }
  }), [chartData]);

  // Optimized data fetching function
  const fetchLatestClientData = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/clients`);
      if (!response.ok) throw new Error('Failed to fetch client data');
      const data = await response.json();
      const updatedClient = data.find((c: any) => c.hostname === client.hostname);
      if (updatedClient) {
        setLocalClient(prevClient => ({
          ...prevClient,
          ...updatedClient,
          ping_history: updatedClient.ping_history || [],
          tags: updatedClient.tags || []
        }));
      }
    } catch (error) {
      console.error('Error fetching client data:', error);
    }
  }, [client.hostname]);

  const fetchPingConfigs = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/ping-config`);
      if (!response.ok) throw new Error('Failed to fetch ping configs');
      setPingConfigs(await response.json());
    } catch (error) {
      console.error('Error fetching ping configs:', error);
    }
  }, []);

  // Optimized utility functions
  const formatters = useMemo(() => ({
    threadCount: (cpuModel: string | null | undefined, cpuThreads?: number): string => {
      if (typeof cpuThreads === 'number' && cpuThreads > 0) return `${cpuThreads}C`;
      if (!cpuModel) return '0C';
      
      const threadMatches = [/(\d+)\s*Threads?/i, /(\d+)C\s*(\d+)T/i, /Core\s*(\d+)\s*Threads?/i, /(\d+)\s*Cores?/i];
      for (const pattern of threadMatches) {
        const match = cpuModel.match(pattern);
        if (match) return `${pattern.toString().includes('C') && match[2] ? match[2] : match[1]}C`;
      }
      return '0C';
    },
    memorySize: (bytes?: number): string => 
      typeof bytes === 'number' && bytes > 0 ? `${Math.round(bytes / (1024 * 1024 * 1024))}G` : '0G',
    uptime: (seconds?: number): string => {
      if (typeof seconds === 'undefined') return 'Unknown';
      const days = Math.floor(seconds / (24 * 60 * 60));
      const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((seconds % (60 * 60)) / 60);
      
      if (days === 0 && hours === 0 && minutes === 0) return 'Just started';
      
      return [
        days > 0 && `${days}d`,
        hours > 0 && `${hours}h`,
        minutes > 0 && `${minutes}m`
      ].filter(Boolean).join(' ');
    },
    traffic: (value?: string) => value && value !== 'Unknown' ? value : 'Unknown'
  }), []);

  // Optimized chart data update function
  const updateChartData = useCallback(() => {
    if (!localClient.ping_history) return;

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    // Sort pingConfigs by creation time and get targets in order
    const sortedPingConfigs = [...pingConfigs].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const orderedTargets = sortedPingConfigs.map(config => config.target);
    
    // Filter uniqueTargets to only include targets that exist in ping_history
    // while maintaining the order from orderedTargets
    const uniqueTargets = orderedTargets.filter(target => 
      localClient.ping_history!.some(point => point.target === target)
    );
    
    setTargets(uniqueTargets);

    if (!selectedTarget && uniqueTargets.length > 0) {
      setSelectedTarget(uniqueTargets[0]);
    }

    const datasets = uniqueTargets.map(target => {
      const filteredData = localClient.ping_history!
        .filter(point => point.target === target && point.timestamp >= twentyFourHoursAgo)
        .map(point => ({
          x: point.timestamp,
          y: point.latency
        }))
        .sort((a, b) => a.x - b.x);

      const config = pingConfigs.find(c => c.target === target);
      return {
        label: `Ping ${config?.display_name || target}`,
        data: filteredData,
        borderColor: getColorForTarget(),
        backgroundColor: getBackgroundColorForTarget(),
        borderWidth: 1.5,
        tension: 0.35,
        fill: true,
        hidden: target !== selectedTarget
      };
    });

    setChartData({ datasets });
  }, [localClient.ping_history, selectedTarget, pingConfigs, getColorForTarget, getBackgroundColorForTarget]);

  // Life cycle management
  useEffect(() => {
    setLocalClient(client);
  }, [client]);

  useEffect(() => {
    updateChartData();
  }, [updateChartData]);

  // Restore and optimize real-time update functionality
  useEffect(() => {
    // Immediately get initial data
    fetchLatestClientData();
    fetchPingConfigs();

    // Set more frequent client data update interval (every 2 seconds)
    const clientDataInterval = setInterval(fetchLatestClientData, 2000);
    
    // Set longer configuration update interval (every 30 seconds)
    const configInterval = setInterval(fetchPingConfigs, 30000);

    // Cleanup function
    return () => {
      clearInterval(clientDataInterval);
      clearInterval(configInterval);
    };
  }, [fetchLatestClientData, fetchPingConfigs]);

  const commonCardClass = "bg-[#252525] p-4 rounded-lg";
  const commonLabelClass = "text-sm text-gray-400";
  const commonValueClass = "text-gray-100 mt-1";

  // Fix scrollbar style
  const scrollableStyle = {
    scrollbarWidth: 'none' as const,
    msOverflowStyle: 'none' as const,
    WebkitScrollbar: {
      display: 'none'
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-lg p-4 sm:p-6 w-[calc(100%-2rem)] sm:w-full max-w-4xl h-[calc(100vh-4rem)] sm:h-auto overflow-hidden modal-enter border border-gray-800/20 mx-auto">
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <div className="flex items-center gap-2 sm:gap-3 animate-slide-down">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300 truncate">{client.hostname}</h2>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <div className="flex items-center px-2 sm:px-3 py-1 bg-[#252525] rounded text-xs sm:text-sm text-gray-300 font-medium tracking-wide transition-all duration-300 hover:bg-opacity-80 hover:shadow-md backdrop-blur-sm whitespace-nowrap">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                {formatters.threadCount(client.cpuModel, client.cpuThreads)}·
                {formatters.memorySize(client.memoryTotal)}·
                {formatters.memorySize(client.diskTotal)}
              </div>
              {client.tags?.map((tag) => (
                <div 
                  key={tag} 
                  className="flex items-center px-2 sm:px-3 py-1 bg-[#252525] rounded text-xs sm:text-sm text-gray-300 font-medium tracking-wide transition-all duration-300 hover:bg-opacity-80 hover:scale-105 hover:shadow-md backdrop-blur-sm whitespace-nowrap"
                >
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {tag}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors duration-300 p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-full backdrop-blur-sm"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="h-[calc(100vh-10rem)] sm:h-auto overflow-y-auto hide-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
            {[
              { label: 'CPU Model', value: localClient.cpuModel || 'Unknown' },
              { label: 'Uptime', value: formatters.uptime(localClient.uptime) },
              { label: 'Download Traffic', value: formatters.traffic(localClient.networkTraffic?.rx) },
              { label: 'Upload Traffic', value: formatters.traffic(localClient.networkTraffic?.tx) }
            ].map((item, index) => (
              <div 
                key={item.label}
                className={`${commonCardClass} transition-all duration-300 hover:bg-[#2a2a2a] transform hover:scale-[1.02] animate-fade-in hover:shadow-lg border border-gray-800/10 backdrop-blur-sm`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className={`${commonLabelClass} tracking-wide`}>{item.label}</div>
                <div className={`${commonValueClass} text-sm sm:text-base truncate font-medium tracking-wide`}>{item.value}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 sm:mb-4 flex flex-wrap gap-1.5 sm:gap-2">
            {targets.map((target, index) => {
              const config = pingConfigs.find(c => c.target === target);
              return (
                <button
                  key={target}
                  onClick={() => setSelectedTarget(target)}
                  className={`px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm transition-all duration-300 transform hover:scale-105 animate-fade-in backdrop-blur-sm font-medium tracking-wide ${
                    selectedTarget === target
                      ? 'bg-green-500 text-black shadow-lg shadow-green-500/20 hover:shadow-green-500/30'
                      : 'bg-gray-700/80 text-gray-300 hover:bg-gray-600 hover:shadow-md'
                  }`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {config?.display_name || target}
                </button>
              );
            })}
          </div>

          <div className="h-60 sm:h-80 relative bg-[#252525] rounded-lg p-3 sm:p-4 transition-all duration-300 hover:bg-[#2a2a2a] animate-fade-in border border-gray-800/10 backdrop-blur-sm hover:shadow-lg" style={{ animationDelay: '400ms' }}>
            {chartData && localClient.ping_history && localClient.ping_history.length > 0 ? (
              <Line options={chartOptions} data={chartData} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <div className="flex items-center space-x-2">
                  <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-xs sm:text-sm">Waiting for Ping data...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default DetailModal;