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

// Add saved credentials interface
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
    border-radius: 0 0 0.75rem 0.75rem !important;
  }
  .terminal-container .xterm {
    width: 100% !important;
    height: 100% !important;
    padding: 0 !important;
    background: #1C1C1C !important;
  }
  .terminal-container .xterm-viewport {
    width: 100% !important;
    height: 100% !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    background: #1C1C1C !important;
    border-radius: 0 0 0.75rem 0.75rem !important;
  }
  .terminal-container .xterm-viewport::-webkit-scrollbar {
    display: none !important;
  }
  .terminal-container .xterm-screen {
    width: 100% !important;
    height: 100% !important;
    background: #1C1C1C !important;
    border-radius: 0 0 0.75rem 0.75rem !important;
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
  const [isClosing, setIsClosing] = useState(false);
  const [showCredentialsPrompt, setShowCredentialsPrompt] = useState(false);
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Load saved credentials from server
  useEffect(() => {
    const loadSavedCredentials = async () => {
      if (isAutoLogging) return;
      
      try {
        setIsAutoLogging(true);
        setError('');
        const targetIp = publicIp || clientIp;
        console.log('Loading saved credentials for:', targetIp);
        
        const response = await fetch(`${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(targetIp)}`);
        const data = await response.json();
        
        if (response.ok && data.username) {
          console.log('Found saved credentials for username:', data.username);
          await handleAutoLogin(data.username, data.password);
        } else {
          setError('SSH credentials not found');
        }
      } catch (err) {
        setError('SSH credentials not found');
      } finally {
        setIsAutoLogging(false);
      }
    };

    if (isOpen && !isAuthenticated) {
      loadSavedCredentials();
    }
  }, [isOpen, clientIp, publicIp, isAuthenticated]);

  // Modify auto-login function
  const handleAutoLogin = async (savedUsername: string, savedPassword: string) => {
    if (isConnecting) {
      console.log('Already connecting, skipping...');
      return;
    }

    console.log('Attempting auto-login for:', savedUsername);
    setIsConnecting(true);
    setError('');

    try {
      const targetIp = publicIp || clientIp;
      console.log('Sending verify request:', {
        hostname: targetIp,
        username: savedUsername,
        isAutoLogin: true
      });

      const response = await fetch(`${getApiUrl()}/api/ssh/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: targetIp,
          username: savedUsername,
          password: savedPassword,
          isAutoLogin: true,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Auto-login successful');
        setUsername(savedUsername);
        setPassword(savedPassword);
        setIsAuthenticated(true);
        setError('');
      } else {
        console.error('Auto-login failed:', data.error);
        setUsername(savedUsername);
        setPassword('');
        setError('SSH connection failed: username or password incorrect. Please modify the correct username and password in SSH credentials management.');
      }
    } catch (err) {
      console.error('Auto-login error:', err);
      setError('SSH connection failed: please check your credentials and try again.');
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
              background: '#1C1C1C',
              foreground: '#E2E8F0',
              cursor: '#4CAF50',
              cursorAccent: '#1C1C1C',
              black: '#1C1C1C',
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
            const targetIp = publicIp || clientIp;
            const wsUrl = `${wsProtocol}//${wsHost}${wsPath}?hostname=${encodeURIComponent(targetIp)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

            console.log('Connecting to WebSocket URL:', wsUrl.replace(/password=([^&]+)/, 'password=****')); // Debug log with hidden password
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

    if (isAutoLogin) {
      console.log('Auto-login should use handleAutoLogin instead');
      return;
    }

    if (isConnecting) {
      console.log('Already connecting, skipping...');
      return;
    }

    const currentUsername = username.trim();
    console.log('handleConnect called with:', { currentUsername, isAutoLogin });

    if (!currentUsername) {
      console.error('Username is empty');
      setError('Username cannot be empty');
      return;
    }

    if (!password.trim()) {
      setError('Password cannot be empty');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      const targetIp = publicIp || clientIp;
      console.log('Sending verify request:', {
        hostname: targetIp,
        username: currentUsername,
        isAutoLogin: false
      });

      const response = await fetch(`${getApiUrl()}/api/ssh/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: targetIp,
          username: currentUsername,
          password: password.trim(),
          isAutoLogin: false,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Connection successful');
        setIsAuthenticated(true);
        setError('');
      } else {
        console.error('Connection failed:', data.error);
        // Display different error messages based on error code
        if (data.code === 'NO_CREDENTIALS') {
          setShowCredentialsPrompt(true);
          setError('Please set up SSH credentials first');
        } else if (data.code === 'AUTH_FAILED') {
          setShowCredentialsPrompt(true);
          setError('SSH connection failed: username or password incorrect. Please modify the correct username and password in SSH credentials management.');
        } else {
          setShowCredentialsPrompt(true);
          setError(data.error || 'SSH connection failed, please check your credentials and try again.');
        }
      }
    } catch (err) {
      console.error('Connection error:', err);
      setShowCredentialsPrompt(true);
      setError('Connection error, please try again later.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLogout = async () => {
    // Close WebSocket connection
    if (socketRef.current) {
      socketRef.current.close();
    }
    // Clear terminal instance
    if (terminalInstance.current) {
      terminalInstance.current.dispose();
    }
    
    try {
      // Delete credentials using correct target IP
      const targetIp = publicIp || clientIp;
      await fetch(`${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(targetIp)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Error removing credentials:', err);
    }

    // Reset state
    setIsAuthenticated(false);
    setUsername('');
    setPassword('');
    setError('');
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
      }
      setIsAuthenticated(false);
      // Only clear username and password when no saved credentials exist
      const savedData = localStorage.getItem('ssh_credentials');
      if (!savedData) {
        setUsername('');
        setPassword('');
      }
      setError('');
      setIsClosing(false);
      onClose();
    }, 300); // Animation duration
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4 ${isClosing ? 'backdrop-exit' : 'backdrop-enter'}`}>
      <div className={`bg-[#1C1C1C] rounded-xl shadow-2xl w-full max-w-5xl h-[95vh] sm:h-[85vh] border border-gray-800/30 ${isClosing ? 'modal-exit' : 'modal-enter'}`}>
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

        <div className="h-[calc(100%-3.5rem)] flex flex-col overflow-hidden p-2 bg-[#1C1C1C] rounded-b-xl">
          {!isAuthenticated ? (
            !isAutoLogging && error && (
              <div className="min-h-full flex items-center justify-center p-4 sm:p-6 animate-fade-in">
                <div className="w-full max-w-2xl mx-auto">
                  <div className="bg-[#252525] rounded-xl shadow-2xl overflow-hidden border border-red-500/10">
                    <div className="p-6">
                      <div className="flex items-start space-x-4">
                        <div className="flex-shrink-0 bg-red-500/10 rounded-lg p-2">
                          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-red-400 mb-1">Connection Failed</h3>
                          <p className="text-gray-300 text-sm leading-relaxed">
                            {error}
                          </p>
                        </div>
                      </div>
                      <div className="mt-6 flex items-center justify-end">
                        <button
                          onClick={handleClose}
                          className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-all duration-200 border border-gray-700/50"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div 
              ref={terminalRef} 
              className="flex-1 terminal-container rounded-lg"
              style={{ minHeight: 0 }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHTerminalModal; 