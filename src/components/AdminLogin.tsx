import React, { useState, useEffect } from 'react';
import '../styles/animations.css';

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

// Function to get API URL
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = '3000'; // Backend server port
  return `${protocol}//${hostname}:${port}`;
};

const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordSet, setIsPasswordSet] = useState<boolean | null>(null);

  useEffect(() => {
    checkPasswordStatus();
  }, []);

  const checkPasswordStatus = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/admin/password-status`);
      const data = await response.json();
      setIsPasswordSet(data.isSet);
    } catch (err) {
      setError('Failed to check password status');
    }
  };

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
        onLoginSuccess();
      } else {
        setError(data.error || 'Failed to set password');
      }
    } catch (err) {
      setError('Failed to set password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${getApiUrl()}/api/admin/verify-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      if (response.ok) {
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

  if (isPasswordSet === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1C1C1C] px-4 sm:px-0">
        <div className="w-full max-w-md p-6 sm:p-8 bg-[#252525] rounded-lg shadow-lg">
          <div className="flex flex-col items-center">
            <div className="relative">
              <svg className="w-10 sm:w-12 h-10 sm:h-12 loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path className="loading-track text-blue-500" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
                <path className="text-blue-500" strokeLinecap="round" strokeDasharray="16" strokeDashoffset="16" d="M12 2C6.47715 2 2 6.47715 2 12">
                  <animate attributeName="stroke-dashoffset" values="16;0" dur="0.6s" fill="freeze" />
                </path>
              </svg>
            </div>
            <div className="mt-3 sm:mt-4 text-gray-400 text-sm font-medium loading-pulse">Checking password status</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1C1C1C] px-4 sm:px-0">
      <div className="w-full max-w-md p-6 sm:p-8 bg-[#252525] rounded-lg shadow-lg animate-fade-in backdrop-blur-sm bg-opacity-95 transition-all duration-300 hover:shadow-xl">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-4 sm:mb-6 text-center animate-slide-down">
          {isPasswordSet ? 'Admin Login' : 'Set Admin Password'}
        </h2>

        <form onSubmit={isPasswordSet ? handleLogin : handleSetPassword} className="space-y-3 sm:space-y-4">
          <div className="transform transition-all duration-200 hover:scale-[1.02]">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-3 sm:px-4 py-2 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300 hover:bg-opacity-80 text-sm sm:text-base font-medium tracking-wide"
              disabled={isLoading}
            />
          </div>

          {!isPasswordSet && (
            <div className="transform transition-all duration-200 hover:scale-[1.02]">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-3 sm:px-4 py-2 bg-[#1C1C1C] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300 hover:bg-opacity-80 text-sm sm:text-base font-medium tracking-wide"
                disabled={isLoading}
              />
            </div>
          )}

          {error && (
            <div className="text-red-500 text-xs sm:text-sm animate-shake font-medium tracking-wide">
              {error}
            </div>
          )}

          <button
            type="submit"
            className={`w-full py-2 rounded-lg font-medium tracking-wide transition-all duration-300 transform hover:scale-[1.02] text-sm sm:text-base ${
              isLoading
                ? 'bg-blue-400 cursor-not-allowed opacity-80'
                : 'bg-blue-500 hover:bg-blue-400 hover:shadow-lg active:scale-95'
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