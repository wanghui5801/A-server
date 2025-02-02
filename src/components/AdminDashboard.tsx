import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AdminLogin from './AdminLogin';
import SSHTerminalModal from './SSHTerminalModal';
import '../styles/animations.css';
import socketIOClient from 'socket.io-client';

interface MonitoredClient {
  hostname: string;
  status: 'pending' | 'online' | 'down';
  created_at: string;
  sort_order: number;
  client_ip?: string;
  public_ip?: string;
  last_seen?: string;
  tags?: string[];
  ping_history?: { target: string; created_at: string }[];
}

interface PingConfig {
  id: number;
  target: string;
  display_name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  port: number;
  interval: number;
}

// Create a function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
};

// Create a function to get socket URL
const getSocketUrl = () => {
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

// Change Password Modal Component
const ChangePasswordModal = React.memo(({ isOpen, onClose }: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      setIsLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      // First verify current password
      const verifyResponse = await fetch(`${getApiUrl()}/api/admin/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword }),
      });

      if (!verifyResponse.ok) {
        setError('Current password is incorrect');
        setIsLoading(false);
        return;
      }

      // Update new password
      const changeResponse = await fetch(`${getApiUrl()}/api/admin/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          currentPassword,
          newPassword 
        }),
      });

      if (changeResponse.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onClose();
      } else {
        const data = await changeResponse.json();
        setError(data.error || 'Failed to change password');
      }
    } catch (err) {
      setError('Failed to change password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl w-full sm:w-[480px] border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">Change Admin Password</h2>
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
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current Password"
                className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                disabled={isLoading}
              />
            </div>
            <div className="relative group">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New Password"
                className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                disabled={isLoading}
              />
            </div>
            <div className="relative group">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm New Password"
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
                    Processing...
                  </span>
                ) : (
                  'Change Password'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

// Add Tag Modal Component
const AddTagModal = React.memo(({ isOpen, onClose, onAddTag }: {
  isOpen: boolean;
  onClose: () => void;
  onAddTag: (tag: string) => Promise<void>;
}) => {
  const [tag, setTag] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!tag.trim()) {
      setError('Tag cannot be empty');
      setIsLoading(false);
      return;
    }

    try {
      await onAddTag(tag.trim());
      setTag('');
      onClose();
    } catch (err) {
      setError('Failed to add tag');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl p-4 sm:p-6 w-full max-w-md border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="flex justify-between items-center mb-5 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">Add Tag</h2>
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
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="Enter tag name"
              className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
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
              className="px-4 py-2 bg-green-500/90 text-white rounded-lg hover:bg-green-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-green-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-green-400/20"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Adding...
                </span>
              ) : (
                'Add Tag'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

// Add Client Modal Component
const AddClientModal = React.memo(({ isOpen, onClose, onAddClient }: {
  isOpen: boolean;
  onClose: () => void;
  onAddClient: (hostname: string) => Promise<void>;
}) => {
  const [newHostname, setNewHostname] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onAddClient(newHostname);
      setNewHostname('');
      setError('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add client');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl w-full sm:w-[480px] border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">Add Monitoring Client</h2>
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
                value={newHostname}
                onChange={(e) => setNewHostname(e.target.value)}
                placeholder="Enter hostname"
                className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
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
                className="px-4 py-2 bg-green-500/90 text-white rounded-lg hover:bg-green-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-green-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-green-400/20"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Adding...
                  </span>
                ) : (
                  'Add Client'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

// Ping Config Modal Component
const PingConfigModal = React.memo(({ isOpen, onClose, pingConfigs, onAddConfig, onDeleteConfig }: {
  isOpen: boolean;
  onClose: () => void;
  pingConfigs: PingConfig[];
  onAddConfig: (target: string, name: string, description: string, port: number, interval: number) => Promise<void>;
  onDeleteConfig: (id: number, target: string) => void;
}) => {
  const [newPingTarget, setNewPingTarget] = useState('');
  const [newPingName, setNewPingName] = useState('');
  const [newPingDescription, setNewPingDescription] = useState('');
  const [newPingPort, setNewPingPort] = useState('80');
  const [newPingInterval, setNewPingInterval] = useState('5');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Check if the name already exists
    const nameExists = pingConfigs.some(config => 
      config.display_name.toLowerCase() === newPingName.toLowerCase()
    );

    if (nameExists) {
      setError('A configuration with this name already exists');
      setIsLoading(false);
      return;
    }

    try {
      await onAddConfig(
        newPingTarget,
        newPingName,
        newPingDescription,
        parseInt(newPingPort) || 80,
        parseInt(newPingInterval) || 60
      );
      // Reset form
      setNewPingTarget('');
      setNewPingName('');
      setNewPingDescription('');
      setNewPingPort('');
      setNewPingInterval('');
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to add ping configuration');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl w-full sm:w-auto max-w-2xl border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">Ping Configuration Management</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors duration-300 p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10 group"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 mb-5 sm:mb-6">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="relative group flex-1">
                <input
                  type="text"
                  value={newPingTarget}
                  onChange={(e) => setNewPingTarget(e.target.value)}
                  placeholder="Enter target IP address"
                  className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                  disabled={isLoading}
                />
              </div>
              <div className="relative group flex-1">
                <input
                  type="text"
                  value={newPingName}
                  onChange={(e) => setNewPingName(e.target.value)}
                  placeholder="Enter display name"
                  className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="relative group flex-1">
                <input
                  type="text"
                  value={newPingDescription}
                  onChange={(e) => setNewPingDescription(e.target.value)}
                  placeholder="Enter description (optional)"
                  className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <div className="relative group flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newPingPort}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setNewPingPort(value);
                  }}
                  placeholder="Port"
                  className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                  disabled={isLoading}
                />
              </div>
              <div className="relative group flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newPingInterval}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setNewPingInterval(value);
                  }}
                  placeholder="Interval"
                  className="w-full px-4 py-2.5 bg-[#252525] rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/10 group-hover:bg-[#2a2a2a]"
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                className="px-6 py-2.5 bg-green-500/90 text-white rounded-lg hover:bg-green-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-green-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm border border-green-400/20 whitespace-nowrap"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Adding...
                  </span>
                ) : (
                  'Add Config'
                )}
              </button>
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
          </form>

          <div className="space-y-2.5 max-h-[40vh] sm:max-h-[60vh] overflow-y-auto">
            {pingConfigs.map((config) => (
              <div 
                key={config.id} 
                className="flex flex-col sm:flex-row sm:items-center justify-between bg-[#252525] p-4 rounded-lg gap-3 sm:gap-4 transition-all duration-300 hover:bg-[#2a2a2a] group border border-gray-800/10 hover:shadow-lg"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm sm:text-base text-gray-200 group-hover:text-white transition-colors duration-300 font-medium">{config.display_name || config.target}</span>
                  <span className="text-xs sm:text-sm text-gray-400 group-hover:text-gray-300 transition-colors duration-300">{config.target}</span>
                  {config.description && (
                    <span className="text-xs sm:text-sm text-gray-500 group-hover:text-gray-400 transition-colors duration-300">{config.description}</span>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors duration-300 bg-gray-700/50 px-2 py-0.5 rounded">Port: {config.port || 80}</span>
                    <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors duration-300 bg-gray-700/50 px-2 py-0.5 rounded">Interval: {config.interval || 5}s</span>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteConfig(config.id, config.target)}
                  className="px-4 py-2 bg-red-500/90 text-white rounded-lg hover:bg-red-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-red-500/20 active:scale-95 backdrop-blur-sm border border-red-400/20 self-end sm:self-auto"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const ConfirmDialog = React.memo(({ isOpen, onClose, onConfirm, title, message }: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 animate-fade-in">
      <div className="bg-[#1C1C1C] rounded-xl w-full sm:w-auto max-w-md border border-gray-800/20 shadow-2xl animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors duration-300 p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10 group"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm sm:text-base text-gray-300 mb-6 leading-relaxed">{message}</p>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors duration-300 rounded-lg hover:bg-gray-800/50 backdrop-blur-sm border border-gray-800/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 bg-red-500/90 text-white rounded-lg hover:bg-red-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-red-500/20 active:scale-95 backdrop-blur-sm border border-red-400/20"
            >
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

const AdminDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clients, setClients] = useState<MonitoredClient[]>([]);
  const [pingConfigs, setPingConfigs] = useState<PingConfig[]>([]);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [isPingConfigModalOpen, setIsPingConfigModalOpen] = useState(false);
  const [isAddTagModalOpen, setIsAddTagModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isDeleteClientModalOpen, setIsDeleteClientModalOpen] = useState(false);
  const [isDeletePingModalOpen, setIsDeletePingModalOpen] = useState(false);
  const [isDeleteTagModalOpen, setIsDeleteTagModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ 
    hostname?: string; 
    id?: number; 
    tag?: string;
    target?: string;
  }>({});
  const [isSSHModalOpen, setIsSSHModalOpen] = useState(false);
  const [selectedSSHClient, setSelectedSSHClient] = useState<{ hostname: string; ip: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [serverPublicIP, setServerPublicIP] = useState<string>('');

  const fetchClients = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/monitored-clients`, {
        headers: {
          'X-Internal-Request': 'true'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const clientsWithPublicIP = data
        .map((client: MonitoredClient) => ({
          ...client,
          public_ip: client.public_ip || client.client_ip || 'Retrieving...'
        }))
        .sort((a: MonitoredClient, b: MonitoredClient) => b.sort_order - a.sort_order);
      setClients(clientsWithPublicIP);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching monitored clients:', err);
      setError('Failed to fetch monitored client list');
      setLoading(false);
    }
  }, []);

  const fetchPingConfig = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/ping-config`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setPingConfigs(data);
    } catch (err) {
      console.error('Error fetching ping config:', err);
      setError('Failed to fetch Ping configuration');
    }
  }, []);

  const fetchServerIP = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/server-info`, {
        headers: {
          'X-Internal-Request': 'true',
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Unauthorized access to server info');
        }
        throw new Error('Failed to fetch server info');
      }
      
      const data = await response.json();
      if (!data.public_ip) {
        throw new Error('Server IP not available');
      }
      setServerPublicIP(data.public_ip);
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('Error fetching server IP:', err);
      setError('Failed to fetch server IP');
      setServerPublicIP(''); // Reset server IP on error
    }
  }, []);

  // Ensure we fetch the server IP periodically
  useEffect(() => {
    fetchServerIP(); // Initial fetch
    const serverIPInterval = setInterval(fetchServerIP, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(serverIPInterval);
  }, [fetchServerIP]);

  // Initialize socket event listeners when component mounts
  useEffect(() => {
    if (typeof window === 'undefined' || !socket) return;

    const handleSocketEvents = () => {
      const handleConnect = () => {
        console.log('Socket connected successfully');
        setConnected(true);
        setError('');
        fetchClients();
        fetchPingConfig();
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
  }, [fetchClients, fetchPingConfig]);

  // Optimize periodic updates
  useEffect(() => {
    // Get initial data immediately
    fetchClients();
    fetchPingConfig();

    // Set update interval (update client data every 5 seconds)
    const clientsInterval = setInterval(fetchClients, 5000);
    
    // Set longer configuration update interval (every 30 seconds)
    const configInterval = setInterval(fetchPingConfig, 30000);

    return () => {
      clearInterval(clientsInterval);
      clearInterval(configInterval);
    };
  }, [fetchClients, fetchPingConfig]);

  const addClient = useCallback(async (hostname: string) => {
    if (!hostname.trim()) {
      throw new Error('Please enter a hostname');
    }

    const response = await fetch(`${getApiUrl()}/api/monitored-clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hostname: hostname.trim() }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to add client');
    }

    await fetchClients();
  }, [fetchClients]);

  const handleAddPingConfig = async (target: string, name: string, description: string, port: number, interval: number) => {
    if (!target || !name) {
      throw new Error(target ? 'Please enter a display name' : 'Please enter a target IP address');
    }

    const response = await fetch(`${getApiUrl()}/api/ping-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        target,
        display_name: name,
        description: description || `Added at ${new Date().toLocaleString()}`,
        port,
        interval
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update ping target');
    }

    fetchPingConfig();
  };

  const handleDeleteClient = (hostname: string) => {
    setDeleteTarget({ hostname });
    setIsDeleteClientModalOpen(true);
  };

  const handleDeletePingConfig = async (id: number, target: string) => {
    setDeleteTarget({ id, target });
    setIsDeletePingModalOpen(true);
  };

  const handleDeleteTag = (hostname: string, tag: string) => {
    setDeleteTarget({ hostname, tag });
    setIsDeleteTagModalOpen(true);
  };

  const confirmDeleteClient = useCallback(async (hostname: string) => {
    try {
      // Double encode the hostname to handle special characters
      const encodedHostname = encodeURIComponent(encodeURIComponent(hostname));
      const response = await fetch(`${getApiUrl()}/api/monitored-clients/${encodedHostname}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await fetchClients();
      setIsDeleteClientModalOpen(false);
    } catch (err) {
      console.error('Error deleting client:', err);
      setError('Failed to delete client');
    }
  }, [fetchClients]);

  const confirmDeletePingTarget = async (id: number, target: string) => {
    try {
      // 1. Delete Ping configuration
      const response = await fetch(`${getApiUrl()}/api/ping-config/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete ping target');
      }

      // 2. Clean up related historical data
      const cleanupResponse = await fetch(`${getApiUrl()}/api/ping-config/${id}/cleanup`, {
        method: 'POST',
      });

      if (!cleanupResponse.ok) {
        console.error('Failed to cleanup ping history data');
      }

      // 3. Update local state
      setClients(prevClients => 
        prevClients.map(client => ({
          ...client,
          // Clear historical data related to this ping configuration
          ping_history: client.ping_history?.filter(history => history.target !== target) || []
        }))
      );

      fetchPingConfig();
      setIsDeletePingModalOpen(false);
    } catch (err) {
      console.error('Error deleting ping target:', err);
      setError('Failed to delete ping target');
    }
  };

  const confirmDeleteTag = async (hostname: string, tag: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/tags/${hostname}/${tag}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete tag');
      }

      // Update the clients list to reflect the tag deletion
      setClients(clients.map(client => {
        if (client.hostname === hostname) {
          return {
            ...client,
            tags: client.tags?.filter(t => t !== tag) || []
          };
        }
        return client;
      }));
      
      // Close confirmation modal
      setIsDeleteTagModalOpen(false);
    } catch (error) {
      console.error('Error deleting tag:', error);
      alert('Failed to delete tag');
    }
  };

  const updateSortOrder = async (hostname: string, sort_order: number) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/monitored-clients/${hostname}/sort`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sort_order }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      fetchClients();
    } catch (err) {
      console.error('Error updating sort order:', err);
      setError('Failed to update sort order');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'down':
        return 'bg-red-500';
      default:
        return 'bg-yellow-500';
    }
  };

  const addTag = async (hostname: string) => {
    setSelectedClient(hostname);
    setIsAddTagModalOpen(true);
  };

  const handleAddTag = async (tag: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/client/add-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          hostname: selectedClient,
          tag 
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add tag');
      }

      // Update local state
      setClients(prevClients => 
        prevClients.map(client => 
          client.hostname === selectedClient
            ? { ...client, tags: [...(client.tags || []), tag] }
            : client
        )
      );

      setIsAddTagModalOpen(false);
    } catch (err) {
      console.error('Error adding tag:', err);
      setError('Failed to add tag');
    }
  };

  const deleteTag = async (hostname: string, tag: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/tags/${hostname}/${tag}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete tag');
      }

      // Update the clients list to reflect the tag deletion
      setClients(clients.map(client => {
        if (client.hostname === hostname) {
          return {
            ...client,
            tags: client.tags?.filter(t => t !== tag) || []
          };
        }
        return client;
      }));
    } catch (error) {
      console.error('Error deleting tag:', error);
      alert('Failed to delete tag');
    }
  };

  const copySetupCommand = async (hostname: string) => {
    try {
      if (!serverPublicIP) {
        // If server IP is not available, try to fetch it again
        await fetchServerIP();
        if (!serverPublicIP) {
          throw new Error('Server IP not available. Please try again in a few moments.');
        }
      }
      
      // Properly escape hostname for shell command
      // First escape any existing single quotes
      const escapedHostname = hostname.replace(/'/g, "'\\''");
      // Then wrap in single quotes to preserve all special characters
      const setupCommand = `curl -L https://raw.githubusercontent.com/wanghui5801/A-server/main/setup-client.sh -o setup-client.sh && chmod +x setup-client.sh && ./setup-client.sh '${escapedHostname}' "${serverPublicIP}"`;
      
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(setupCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = setupCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const success = document.execCommand('copy');
          if (!success) {
            throw new Error('Failed to copy command');
          }
        } finally {
          textArea.remove();
        }
      }
      
      setCopySuccess(hostname);
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      console.error('Failed to copy command:', err);
      setError(err instanceof Error ? err.message : 'Failed to copy command');
      setCopySuccess('');
    }
  };

  if (!isAuthenticated) {
    return <AdminLogin onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#1C1C1C]">
        <div className="relative">
          <svg className="w-12 h-12 loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path className="loading-track text-blue-500" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
            <path className="text-blue-500" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
              <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
            </path>
          </svg>
        </div>
        <div className="mt-4 text-gray-400 text-sm font-medium loading-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1C1C1C] text-white p-4 sm:p-8">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-12 animate-fade-in">
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
              <div className="flex items-center group">
                <div className="relative mr-3 sm:mr-4">
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-gray-300/90 transition-all duration-300 group-hover:scale-105 group-hover:text-gray-200/90" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                      d="M6.5 12h2l2-6 3 18 2.5-12h2" />
                    <path strokeLinecap="round" strokeWidth={1.5}
                      d="M3 12h2M19 12h2" />
                    <path strokeLinecap="round" strokeWidth={1.5} opacity="0.5"
                      d="M1 12h1M22 12h1" />
                    <circle cx="12" cy="12" r="9" strokeWidth={1.5} opacity="0.2" className="animate-pulse" />
                    <circle cx="12" cy="12" r="5" strokeWidth={1.5} opacity="0.3" />
                  </svg>
                </div>
                <h1 className="text-2xl sm:text-4xl font-medium tracking-tight text-gray-200 transition-colors duration-300 group-hover:text-gray-100">Management</h1>
              </div>
              <div className="grid grid-cols-2 sm:flex gap-2.5 sm:gap-3">
                <a
                  href="/"
                  className="flex items-center justify-center px-3.5 sm:px-4 py-2 sm:py-2.5 bg-gray-700/80 text-white rounded-lg hover:bg-gray-600/90 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 backdrop-blur-sm text-sm sm:text-base font-medium tracking-wide border border-gray-600/10 group"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2 transition-transform duration-300 group-hover:rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <span className="relative">Back to Home</span>
                </a>
                <button
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-yellow-500/90 text-white rounded-lg hover:bg-yellow-400/90 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 text-sm sm:text-base font-medium tracking-wide border border-yellow-400/10 backdrop-blur-sm"
                >
                  Change Password
                </button>
                <button
                  onClick={() => setIsAddClientModalOpen(true)}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-green-500/90 text-white rounded-lg hover:bg-green-400/90 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 text-sm sm:text-base font-medium tracking-wide border border-green-400/10 backdrop-blur-sm"
                >
                  Add Client
                </button>
                <button
                  onClick={() => setIsPingConfigModalOpen(true)}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-blue-500/90 text-white rounded-lg hover:bg-blue-400/90 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg active:scale-95 text-sm sm:text-base font-medium tracking-wide border border-blue-400/10 backdrop-blur-sm"
                >
                  Ping Config
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-4 text-sm text-red-400 animate-shake font-medium tracking-wide">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {clients.map((client, index) => (
            <div
              key={client.hostname}
              className="bg-[#1E1E1E] rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between transition-all duration-300 transform hover:scale-[1.01] hover:shadow-xl animate-fade-in hover:bg-[#252525] gap-3 sm:gap-0 border border-gray-800/10 backdrop-blur-sm"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Mobile Layout */}
              <div className="sm:hidden">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`
                        inline-flex items-center px-2.5 py-1 rounded text-xs font-medium tracking-wide whitespace-nowrap
                        ${getStatusColor(client.status)}
                        shadow-sm backdrop-blur-sm border border-gray-800/10
                      `}>
                        {client.status}
                      </div>
                      <span className="text-gray-300 font-medium text-sm tracking-wide group-hover:text-white transition-colors duration-300 truncate">
                        {client.hostname || 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={client.sort_order}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateSortOrder(client.hostname, parseInt(e.target.value) || 0);
                        }}
                        className="w-14 px-2 py-1 bg-[#252525] rounded text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-green-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-medium border border-gray-800/10"
                        min="0"
                        title="Sort value (larger numbers appear first)"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClient(client.hostname);
                        }}
                        className="bg-red-500/80 text-white px-2.5 py-1 rounded text-xs hover:bg-red-400 transition-colors font-medium tracking-wide flex items-center gap-1"
                        title="Delete client"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        <span>{client.public_ip || 'Unknown IP'}</span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copySetupCommand(client.hostname);
                        }}
                        className="bg-green-500/80 text-white px-2.5 py-1 rounded text-xs hover:bg-green-400 transition-colors font-medium tracking-wide flex items-center gap-1.5"
                        title="Copy setup command"
                      >
                        {copySuccess === client.hostname ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                            <span>Setup</span>
                          </>
                        )}
                      </button>
                    </div>
                    {client.last_seen && (
                      <span className="text-gray-500 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {new Date(client.last_seen).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {client.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-200 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                      >
                        {tag}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTag(client.hostname, tag);
                          }}
                          className="ml-1.5 hover:text-red-300 focus:outline-none"
                          title="Delete tag"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addTag(client.hostname);
                      }}
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors border border-blue-500/30"
                      title="Add tag"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Desktop Layout */}
              <div className="hidden sm:flex sm:items-center sm:justify-between w-full">
                <div className="flex items-center space-x-5">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => copySetupCommand(client.hostname)}
                      className="bg-green-500/90 text-white px-3 py-1.5 rounded-lg hover:bg-green-400 transition-colors flex items-center gap-1.5 font-medium tracking-wide shadow-sm hover:shadow-md"
                      title="Copy setup command"
                    >
                      {copySuccess === client.hostname ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          <span>Setup</span>
                        </>
                      )}
                    </button>
                    <input
                      type="number"
                      value={client.sort_order}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateSortOrder(client.hostname, parseInt(e.target.value) || 0);
                      }}
                      className="w-16 px-2.5 py-1.5 bg-[#252525] rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      min="0"
                      title="Sort value (larger numbers appear first)"
                    />
                    <div className={`px-3 py-1.5 rounded-lg text-sm font-medium tracking-wide ${getStatusColor(client.status)} shadow-sm`}>
                      {client.status}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2.5">
                      <span className="text-gray-200 font-medium tracking-wide">{client.hostname}</span>
                      <div className="flex items-center gap-2">
                        {client.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/30 text-blue-200 border border-blue-500/50 hover:bg-blue-500/40 transition-colors shadow-sm"
                          >
                            {tag}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTag(client.hostname, tag);
                              }}
                              className="ml-1.5 hover:text-red-300 focus:outline-none"
                              title="Delete tag"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addTag(client.hostname);
                          }}
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors border border-blue-500/40 shadow-sm"
                          title="Add tag"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-sm text-gray-500 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        {client.public_ip || 'Retrieving...'}
                      </span>
                      {client.last_seen && (
                        <span className="text-xs text-gray-600 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {new Date(client.last_seen).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      setSelectedSSHClient({ 
                        hostname: client.hostname, 
                        ip: client.public_ip || client.client_ip || '' 
                      });
                      setIsSSHModalOpen(true);
                    }}
                    className="hidden sm:flex items-center gap-1.5 bg-blue-500/90 text-white px-3 py-1.5 rounded-lg hover:bg-blue-400 transition-colors font-medium tracking-wide shadow-sm hover:shadow-md"
                    title="SSH Connection"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    SSH
                  </button>
                  <button
                    onClick={() => handleDeleteClient(client.hostname)}
                    className="flex items-center gap-1.5 bg-red-500/90 text-white px-3 py-1.5 rounded-lg hover:bg-red-400 transition-colors font-medium tracking-wide shadow-sm hover:shadow-md"
                    title="Delete client"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ChangePasswordModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
      />

      <AddClientModal
        isOpen={isAddClientModalOpen}
        onClose={() => setIsAddClientModalOpen(false)}
        onAddClient={addClient}
      />

      <PingConfigModal
        isOpen={isPingConfigModalOpen}
        onClose={() => setIsPingConfigModalOpen(false)}
        pingConfigs={pingConfigs}
        onAddConfig={handleAddPingConfig}
        onDeleteConfig={handleDeletePingConfig}
      />

      <AddTagModal
        isOpen={isAddTagModalOpen}
        onClose={() => setIsAddTagModalOpen(false)}
        onAddTag={handleAddTag}
      />

      <ConfirmDialog
        isOpen={isDeleteClientModalOpen}
        onClose={() => setIsDeleteClientModalOpen(false)}
        onConfirm={() => deleteTarget.hostname && confirmDeleteClient(deleteTarget.hostname)}
        title="Delete Client"
        message={`Are you sure you want to delete client "${deleteTarget.hostname}"? This action cannot be undone.`}
      />

      <ConfirmDialog
        isOpen={isDeletePingModalOpen}
        onClose={() => setIsDeletePingModalOpen(false)}
        onConfirm={() => deleteTarget.id !== undefined && deleteTarget.target && 
          confirmDeletePingTarget(deleteTarget.id, deleteTarget.target)}
        title="Delete Ping Configuration"
        message="Are you sure you want to delete this Ping configuration? This action cannot be undone."
      />

      <ConfirmDialog
        isOpen={isDeleteTagModalOpen}
        onClose={() => setIsDeleteTagModalOpen(false)}
        onConfirm={() => deleteTarget.hostname && deleteTarget.tag && confirmDeleteTag(deleteTarget.hostname, deleteTarget.tag)}
        title="Delete Tag"
        message={`Are you sure you want to delete tag "${deleteTarget.tag}"?`}
      />

      {selectedSSHClient && (
        <SSHTerminalModal
          isOpen={isSSHModalOpen}
          onClose={() => {
            setIsSSHModalOpen(false);
            setSelectedSSHClient(null);
          }}
          hostname={selectedSSHClient.hostname}
          clientIp={selectedSSHClient.ip}
        />
      )}
    </div>
  );
}

export default React.memo(AdminDashboard); 