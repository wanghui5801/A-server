import React, { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import '../styles/animations.css';

// Function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
};

// Function to get WebSocket URL
const getWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:3000';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  if (process.env.NODE_ENV === 'development') {
    return `${protocol}//localhost:3000`;
  }
  
  return `${protocol}//${window.location.host}`;
};

interface SSHTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostname: string;
  clientIp: string;
  publicIp?: string;
}

interface SSHMessage {
  type: 'data' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

// 添加保存的登录信息接口
interface SavedCredentials {
  username: string;
  password: string;
  clientIp: string;
}

// Update the styles to be more mobile-friendly
const styles = `
  .terminal-container {
    width: 100% !important;
    height: 100% !important;
    padding: 4px !important;
    margin: 0 !important;
    position: relative !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    background: #1C1C1C !important;
    border-radius: 4px !important;
  }
  .terminal-container .xterm {
    width: 100% !important;
    height: 100% !important;
    padding: 0 !important;
    background: transparent !important;
  }
  .terminal-container .xterm-viewport {
    width: 100% !important;
    height: 100% !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    background: transparent !important;
  }
  .terminal-container .xterm-viewport::-webkit-scrollbar {
    display: none !important;
  }
  .terminal-container .xterm-screen {
    width: 100% !important;
    height: 100% !important;
    background: transparent !important;
  }
  @media (max-width: 640px) {
    .terminal-container {
      padding: 2px !important;
    }
    .xterm {
      font-size: 14px !important;
    }
  }
`;

const SSHTerminalModal = ({
  isOpen,
  onClose,
  hostname,
  clientIp,
  publicIp,
}: SSHTerminalModalProps): React.ReactElement | null => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAutoLogging, setIsAutoLogging] = useState(false);
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 从服务器加载保存的凭据
  useEffect(() => {
    const loadSavedCredentials = async () => {
      if (isAutoLogging) return; // 防止重复调用
      
      try {
        setIsAutoLogging(true);
        setError('');
        console.log('Loading saved credentials for:', clientIp);
        
        const response = await fetch(`${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(clientIp)}`);
        const data = await response.json();
        
        if (response.ok && data.username) {
          console.log('Found saved credentials for username:', data.username);
          // 直接使用用户名和密码进行自动登录
          await handleAutoLogin(data.username, data.password);
        } else {
          // 没有保存的凭据时静默处理，不显示错误信息
          console.log('No saved credentials found, waiting for manual login');
        }
      } catch (err) {
        // 出现错误时也静默处理，让用户手动登录
        console.error('Error loading saved credentials:', err);
      } finally {
        setIsAutoLogging(false);
      }
    };

    if (isOpen && !isAuthenticated) {
      loadSavedCredentials();
    }
  }, [isOpen, clientIp, isAuthenticated]);

  // 新增自动登录专用函数
  const handleAutoLogin = async (savedUsername: string, savedPassword: string) => {
    if (isConnecting) {
      console.log('Already connecting, skipping...');
      return;
    }

    console.log('Attempting auto-login for:', savedUsername);
    setIsConnecting(true);
    setError('');

    try {
      console.log('Sending verify request:', {
        hostname: clientIp,
        username: savedUsername,
        isAutoLogin: true
      });

      const response = await fetch(`${getApiUrl()}/api/ssh/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: clientIp,
          username: savedUsername,
          password: savedPassword,
          isAutoLogin: true,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Auto-login successful');
        setUsername(savedUsername);
        setPassword(savedPassword); // 保存密码用于WebSocket连接
        setIsAuthenticated(true);
        setError('');
      } else {
        // 自动登录失败时清除状态
        console.error('Auto-login failed:', data.error);
        setUsername('');
        setPassword('');
        setError('');  // 不显示错误信息，让用户重新输入
      }
    } catch (err) {
      // 自动登录出错时也清除状态
      console.error('Auto-login error:', err);
      setUsername('');
      setPassword('');
      setError('');
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    // Add styles to head
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    if (isAuthenticated && terminalRef.current) {
      const initTerminal = async () => {
        try {
          // Dynamically import xterm and plugins
          const [
            { Terminal },
            { FitAddon },
            { WebLinksAddon }
          ] = await Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
            import('@xterm/addon-web-links')
          ]);

          const terminal = new Terminal({
            cursorBlink: true,
            theme: {
              background: '#1E1E1E',
              foreground: '#E2E8F0',
              cursor: '#4CAF50',
              cursorAccent: '#1E1E1E',
              black: '#1E1E1E',
              red: '#FC8181',
              green: '#4CAF50',
              yellow: '#F6E05E',
              blue: '#63B3ED',
              magenta: '#D53F8C',
              cyan: '#38B2AC',
              white: '#E2E8F0',
              brightBlack: '#2D3748',
              brightRed: '#FEB2B2',
              brightGreen: '#68D391',
              brightYellow: '#FAF089',
              brightBlue: '#90CDF4',
              brightMagenta: '#ED64A6',
              brightCyan: '#4FD1C5',
              brightWhite: '#F7FAFC',
            },
            fontSize: 16,
            fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
            scrollback: 1000,
            convertEol: true,
            cursorStyle: 'bar',
            cursorWidth: 2,
            allowTransparency: false,
            allowProposedApi: true,
            windowsMode: false,
            windowOptions: {
              setWinLines: true
            }
          });

          const fitAddon = new FitAddon();
          const webLinksAddon = new WebLinksAddon();

          fitAddonRef.current = fitAddon;
          terminal.loadAddon(fitAddon);
          terminal.loadAddon(webLinksAddon);

          if (terminalRef.current) {
            terminal.open(terminalRef.current);

            // Ensure terminal is fully rendered and sized properly
            const fitTerminal = () => {
              if (fitAddonRef.current && terminalInstance.current) {
                try {
                  fitAddonRef.current.fit();
                  // Send initial size to server
                  if (socketRef.current?.readyState === WebSocket.OPEN) {
                    const { cols, rows } = terminalInstance.current;
                    // Ensure sending reasonable terminal size
                    if (cols >= 80 && rows >= 24) {
                      const message: SSHMessage = {
                        type: 'resize',
                        cols,
                        rows
                      };
                      socketRef.current.send(JSON.stringify(message));
                    }
                  }
                } catch (err) {
                  console.error('Error fitting terminal:', err);
                }
              }
            };

            // Execute immediately
            terminal.onRender(() => {
              setTimeout(fitTerminal, 0);
            });

            // Create a debounced function to handle resize
            let resizeTimeout: NodeJS.Timeout;
            const debouncedFit = () => {
              clearTimeout(resizeTimeout);
              resizeTimeout = setTimeout(fitTerminal, 100);
            };

            // Add ResizeObserver to respond to container size changes in real-time
            const resizeObserver = new ResizeObserver(debouncedFit);
            resizeObserver.observe(terminalRef.current);

            // Listen for window size changes
            window.addEventListener('resize', debouncedFit);

            terminalInstance.current = terminal;

            // Connect to WebSocket for SSH using dynamic URL
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = process.env.NODE_ENV === 'development' ? 'localhost:3000' : window.location.host;
            const wsPath = process.env.NODE_ENV === 'development' ? '/ssh' : '/api/ssh';
            const wsUrl = `${wsProtocol}//${wsHost}${wsPath}?hostname=${encodeURIComponent(clientIp)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

            console.log('Connecting to WebSocket URL:', wsUrl); // Debug log
            const socket = new WebSocket(wsUrl);

            socket.onopen = () => {
              console.log('WebSocket connection established'); // Add debug log
              terminal.writeln('\x1b[1;36mConnecting to SSH server...\x1b[0m');
              // Adapt size after successful connection
              setTimeout(fitTerminal, 100);
              // Try adapting size again to ensure correct display
              setTimeout(fitTerminal, 500);
            };

            socket.onmessage = (event) => {
              terminal.write(event.data);
            };

            socket.onerror = (error) => {
              console.error('WebSocket error:', error); // Add detailed error log
              terminal.writeln('\x1b[1;31mWebSocket connection error. Please check console for details.\x1b[0m');
            };

            socket.onclose = (event) => {
              console.log('WebSocket connection closed:', event.code, event.reason); // Add detailed close log
              terminal.writeln('\x1b[1;31mConnection closed\x1b[0m');
            };

            socketRef.current = socket;

            terminal.onData((data: string) => {
              if (socket.readyState === WebSocket.OPEN) {
                const message: SSHMessage = { type: 'data', data };
                socket.send(JSON.stringify(message));
              }
            });

            // Clean up on component unmount
            return () => {
              clearTimeout(resizeTimeout);
              window.removeEventListener('resize', debouncedFit);
              resizeObserver.disconnect();
              if (socket.readyState === WebSocket.OPEN) {
                socket.close();
              }
              terminal.dispose();
            };
          }
        } catch (err) {
          console.error('Terminal initialization error:', err);
          setError('Terminal initialization failed');
          setIsAuthenticated(false);
        }
      };

      initTerminal();
    }

    return () => {
      document.head.removeChild(styleSheet);
    };
  }, [isAuthenticated, clientIp]);

  const handleConnect = async (e: React.FormEvent | null, isAutoLogin = false) => {
    if (e) {
      e.preventDefault();
    }

    // 如果是自动登录，不要在这里处理
    if (isAutoLogin) {
      console.log('Auto-login should use handleAutoLogin instead');
      return;
    }

    // 如果已经在连接中，不要重复连接
    if (isConnecting) {
      console.log('Already connecting, skipping...');
      return;
    }

    const currentUsername = username.trim();
    console.log('handleConnect called with:', { currentUsername, isAutoLogin });

    if (!currentUsername) {
      console.error('Username is empty');
      setError('Username is required');
      return;
    }

    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      console.log('Sending verify request:', {
        hostname: clientIp,
        username: currentUsername,
        isAutoLogin: false
      });

      const response = await fetch(`${getApiUrl()}/api/ssh/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: clientIp,
          username: currentUsername,
          password: password.trim(),
          isAutoLogin: false,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Connection successful');
        
        // 保存凭据到服务器
        await fetch(`${getApiUrl()}/api/ssh/credentials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientIp,
            username: currentUsername,
            password: password.trim(),
          }),
        });
        
        setIsAuthenticated(true);
        setError('');
      } else {
        console.error('Connection failed:', data.error);
        setError(data.error || 'Authentication failed. Please check your credentials.');
        // 如果服务器指示凭证已被清除，确保清除本地状态
        if (data.credentialsCleared) {
          setUsername('');
          setPassword('');
        }
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError('Connection error. Please try again.');
      setUsername('');
      setPassword('');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLogout = async () => {
    // 关闭WebSocket连接
    if (socketRef.current) {
      socketRef.current.close();
    }
    // 清除终端实例
    if (terminalInstance.current) {
      terminalInstance.current.dispose();
    }
    
    try {
      // 从服务器删除凭据
      await fetch(`${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(clientIp)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Error removing credentials:', err);
    }

    // 重置状态
    setIsAuthenticated(false);
    setUsername('');
    setPassword('');
    setError('');
  };

  const handleClose = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.close();
    }
    if (terminalInstance.current) {
      terminalInstance.current.dispose();
    }
    setIsAuthenticated(false);
    // 只在没有保存的凭据时才清除用户名和密码
    const savedData = localStorage.getItem('ssh_credentials');
    if (!savedData) {
      setUsername('');
      setPassword('');
    }
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-2 sm:p-4">
      <div className="bg-[#1C1C1C] rounded-xl shadow-2xl w-full max-w-5xl h-[95vh] sm:h-[85vh] border border-gray-800/30 modal-enter">
        <div className="flex justify-between items-center h-14 px-3 sm:px-6 border-b border-gray-800/30">
          <div className="flex items-center gap-2.5 sm:gap-3 animate-slide-down overflow-x-auto pb-2 sm:pb-0">
            <h2 className="text-base sm:text-lg font-medium text-gray-100 whitespace-nowrap">SSH Terminal</h2>
            <div className="flex items-center gap-2">
              <div className="px-2.5 sm:px-3 py-1 bg-[#252525] rounded-lg text-xs sm:text-sm text-gray-300 font-medium transition-all duration-300 hover:bg-opacity-80 whitespace-nowrap border border-gray-800/10">
                {hostname}
              </div>
              <div className="px-2.5 sm:px-3 py-1 bg-[#252525] rounded-lg text-xs sm:text-sm text-gray-300 font-medium transition-all duration-300 hover:bg-opacity-80 whitespace-nowrap border border-gray-800/10">
                {publicIp || clientIp}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="text-gray-400 hover:text-gray-200 transition-colors p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10"
                title="Logout"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            )}
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-200 transition-colors p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10"
              title="Close"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="h-[calc(100%-3.5rem)] flex flex-col overflow-hidden p-2">
          {!isAuthenticated ? (
            !isAutoLogging && (
              <div className="min-h-full flex items-center justify-center bg-[#1C1C1C] p-4 sm:p-6 animate-fade-in">
                <div className="w-full max-w-md p-5 sm:p-8 bg-[#252525] rounded-xl shadow-lg animate-fade-in backdrop-blur-sm bg-opacity-95 border border-gray-800/30">
                  <div className="flex items-center justify-center mb-6 animate-slide-down">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-100">SSH Connection</h2>
                  </div>

                  <form onSubmit={(e) => handleConnect(e)} className="space-y-4">
                    <div className="group">
                      <div className="relative">
                        <input
                          id="username"
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="Username"
                          className="w-full px-3.5 sm:px-4 py-2.5 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/50 group-hover:border-gray-700/50 text-sm sm:text-base placeholder-gray-500"
                          disabled={isConnecting}
                          autoComplete="off"
                          spellCheck="false"
                        />
                      </div>
                    </div>

                    <div className="group">
                      <div className="relative">
                        <input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Password"
                          className="w-full px-3.5 sm:px-4 py-2.5 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 border border-gray-800/50 group-hover:border-gray-700/50 text-sm sm:text-base placeholder-gray-500"
                          disabled={isConnecting}
                        />
                      </div>
                    </div>

                    {error && (
                      <div className="text-red-400 text-xs sm:text-sm bg-red-500/10 px-3.5 py-2.5 rounded-lg border border-red-500/20 animate-shake">
                        <div className="flex items-center space-x-2">
                          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-medium">{error}</span>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      className={`w-full py-2.5 sm:py-3 rounded-lg font-medium transition-all duration-300 text-sm sm:text-base shadow-lg ${
                        isConnecting
                          ? 'bg-green-500/70 cursor-not-allowed'
                          : 'bg-green-500 hover:bg-green-400 hover:shadow-xl active:scale-[0.98]'
                      }`}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          <span>Connecting...</span>
                        </div>
                      ) : (
                        <span>Connect</span>
                      )}
                    </button>
                  </form>
                </div>
              </div>
            )
          ) : (
            <div 
              ref={terminalRef} 
              className="flex-1 bg-[#1E1E1E] terminal-container rounded-lg"
              style={{ minHeight: 0 }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHTerminalModal; 