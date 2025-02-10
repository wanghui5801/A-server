import React, { useState, useEffect } from 'react';
import '../styles/animations.css';

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

// Function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
};

// Token management functions
const saveToken = (token: string) => {
  localStorage.setItem('adminToken', token);
  localStorage.setItem('tokenTimestamp', Date.now().toString());
};

const getToken = () => {
  const token = localStorage.getItem('adminToken');
  const timestamp = localStorage.getItem('tokenTimestamp');
  
  if (!token || !timestamp) return null;
  
  // Check if token is expired (24 hours)
  const now = Date.now();
  const tokenAge = now - parseInt(timestamp);
  if (tokenAge > 24 * 60 * 60 * 1000) {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('tokenTimestamp');
    return null;
  }
  
  return token;
};

const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordSet, setIsPasswordSet] = useState<boolean | null>(null);
  const [shouldRender, setShouldRender] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        // First check if we have a valid token
        const token = getToken();
        if (token) {
          const response = await fetch(`${getApiUrl()}/api/admin/verify-token`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            setShouldRender(false); // Don't render the component at all
            onLoginSuccess();
            return;
          } else {
            // If token is invalid, remove it
            localStorage.removeItem('adminToken');
            localStorage.removeItem('tokenTimestamp');
          }
        }

        // Only check password status if no valid token exists
        const passwordResponse = await fetch(`${getApiUrl()}/api/admin/password-status`);
        const data = await passwordResponse.json();
        setIsPasswordSet(data.isSet);
      } catch (err) {
        setError('Failed to check authentication status');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [onLoginSuccess]);

  // If we shouldn't render (valid token exists), return null
  if (!shouldRender) {
    return null;
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${getApiUrl()}/api/admin/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      if (response.ok) {
        setIsPasswordSet(true);
        // After setting password, automatically log in
        await handleLogin(e, password);
      } else {
        setError(data.error || 'Failed to set password');
      }
    } catch (err) {
      setError('Failed to set password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent, passwordOverride?: string) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const loginPassword = passwordOverride || password;

    try {
      const response = await fetch(`${getApiUrl()}/api/admin/verify-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: loginPassword }),
      });

      const data = await response.json();
      if (response.ok && data.token) {
        // Save token for auto-login
        saveToken(data.token);
        
        // Reset viewport zoom
        const viewport = document.querySelector('meta[name=viewport]');
        if (viewport) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0');
          setTimeout(() => {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
          }, 100);
        }
        onLoginSuccess();
      } else {
        setError(data.error || 'Incorrect password');
      }
    } catch (err) {
      setError('Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#1C1C1C] px-4 sm:px-0">
        <div className="flex flex-col items-center">
          <div className="relative">
            <svg className="w-10 sm:w-12 h-10 sm:h-12 loading-spinner text-blue-500/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path className="loading-track opacity-20" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
              <path className="opacity-90" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
                <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
              </path>
            </svg>
          </div>
          <div className="mt-4 sm:mt-5 text-gray-300 text-sm sm:text-base font-medium loading-pulse tracking-wide">
            Checking authentication status...
          </div>
        </div>
      </div>
    );
  }

  if (isPasswordSet === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#1C1C1C] px-4 sm:px-0">
        <div className="flex flex-col items-center">
          <div className="relative">
            <svg className="w-10 sm:w-12 h-10 sm:h-12 loading-spinner text-blue-500/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path className="loading-track opacity-20" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
              <path className="opacity-90" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
                <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
              </path>
            </svg>
          </div>
          <div className="mt-4 sm:mt-5 text-gray-300 text-sm sm:text-base font-medium loading-pulse tracking-wide">
            Checking password status...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1C1C1C] p-4 sm:p-0">
      <div className="w-full max-w-md p-6 sm:p-8 bg-[#252525] rounded-xl shadow-2xl animate-fade-in backdrop-blur-sm bg-opacity-95 transition-all duration-300 border border-gray-800/30">
        <div className="flex items-center justify-center mb-6 sm:mb-8 animate-slide-down">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100">
            {isPasswordSet ? 'Admin Login' : 'Set Admin Password'}
          </h2>
        </div>

        <form onSubmit={isPasswordSet ? handleLogin : handleSetPassword} className="space-y-4 sm:space-y-5">
          <div className="group">
            <div className="relative transform transition-all duration-200">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3.5 sm:px-4 py-2.5 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 border border-gray-800/50 group-hover:border-gray-700/50 text-sm sm:text-base font-medium tracking-wide placeholder-gray-500"
                disabled={isLoading}
              />
            </div>
          </div>

          {!isPasswordSet && (
            <div className="group">
              <div className="relative transform transition-all duration-200">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full px-3.5 sm:px-4 py-2.5 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 border border-gray-800/50 group-hover:border-gray-700/50 text-sm sm:text-base font-medium tracking-wide placeholder-gray-500"
                  disabled={isLoading}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-xs sm:text-sm bg-red-500/10 px-3.5 py-2.5 rounded-lg border border-red-500/20 animate-shake">
              <div className="flex items-center space-x-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium tracking-wide">{error}</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            className={`w-full py-2.5 sm:py-3 rounded-lg font-medium tracking-wide transition-all duration-300 transform text-sm sm:text-base shadow-lg ${
              isLoading
                ? 'bg-blue-500/70 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-400 hover:shadow-xl active:scale-[0.98]'
            }`}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span className="font-medium tracking-wide">Processing...</span>
              </div>
            ) : (
              <span>{isPasswordSet ? 'Login' : 'Set Password'}</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin; 