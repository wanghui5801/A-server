import React, { useEffect, useState } from 'react';

interface SSHCredential {
  client_ip: string;
  username: string;
  password: string;
  hostname?: string;
  sort_order: number;
  created_at: string;
}

interface SSHCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return window.location.origin;
};

const SSHCredentialsModal: React.FC<SSHCredentialsModalProps> = ({ isOpen, onClose }) => {
  const [credentials, setCredentials] = useState<SSHCredential[]>([]);
  const [editingCredential, setEditingCredential] = useState<SSHCredential | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      fetchCredentials();
    }
  }, [isOpen]);

  const fetchCredentials = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Get all monitored clients
      const clientsResponse = await fetch(`${getApiUrl()}/api/monitored-clients`);
      if (!clientsResponse.ok) {
        setError('Failed to fetch client information');
        return;
      }
      const clientsData = await clientsResponse.json();

      // If no active clients, return empty array
      if (!clientsData || clientsData.length === 0) {
        setCredentials([]);
        setIsLoading(false);
        return;
      }

      // Get all credentials
      const credResponse = await fetch(`${getApiUrl()}/api/ssh/all-credentials`);
      if (!credResponse.ok) {
        setError('Failed to fetch credentials');
        return;
      }
      const credData = await credResponse.json();

      // Associate credentials with hostnames and sort
      const enrichedCredentials = credData.map((cred: SSHCredential) => {
        const client = clientsData.find((c: any) => 
          c.public_ip === cred.client_ip || c.client_ip === cred.client_ip
        );
        return {
          ...cred,
          hostname: client?.hostname || 'Unknown Client',
          sort_order: client?.sort_order || 0,
          created_at: client?.created_at || new Date().toISOString()
        };
      }).sort((a: any, b: any) => {
        if (b.sort_order !== a.sort_order) {
          return b.sort_order - a.sort_order;
        }
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      setCredentials(enrichedCredentials);
    } catch (err) {
      setError('Error loading credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (credential: SSHCredential) => {
    setEditingCredential({ ...credential });
  };

  const handleSave = async () => {
    if (!editingCredential) return;

    try {
      const response = await fetch(
        `${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(editingCredential.client_ip)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: editingCredential.username,
            password: editingCredential.password,
          }),
        }
      );

      if (response.ok) {
        await fetchCredentials();
        setEditingCredential(null);
      } else {
        setError('Failed to update credentials');
      }
    } catch (err) {
      setError('Error updating credentials');
    }
  };

  const handleDelete = async (clientIp: string) => {
    try {
      const response = await fetch(
        `${getApiUrl()}/api/ssh/credentials/${encodeURIComponent(clientIp)}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
        await fetchCredentials();
      } else {
        setError('Failed to delete credentials');
      }
    } catch (err) {
      setError('Error deleting credentials');
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-0 transition-all duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`bg-[#1C1C1C] rounded-xl w-full max-w-2xl border border-gray-800/20 shadow-2xl transition-all duration-200 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-5 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-100 hover:text-white transition-colors duration-300">SSH Credentials Management</h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-200 transition-all duration-300 p-1.5 sm:p-2 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10 group"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 text-sm text-red-400 bg-red-400/10 px-4 py-2.5 rounded-lg border border-red-400/20 animate-shake">
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent"></div>
            </div>
          ) : credentials.length === 0 ? (
            <div className="text-center py-8">
              <div className="mb-4">
                <svg className="w-16 h-16 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-300 mb-2">No Active Clients</h3>
              <p className="text-gray-500 text-sm">There are currently no active clients to manage SSH credentials for.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {credentials.map((cred) => (
                <div
                  key={cred.client_ip}
                  className="bg-[#252525] rounded-lg p-4 border border-gray-800/10 transition-all duration-300 hover:bg-[#2a2a2a] group hover:shadow-lg"
                >
                  {editingCredential?.client_ip === cred.client_ip ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Client Name</label>
                        <input
                          type="text"
                          value={cred.hostname}
                          disabled
                          className="w-full px-4 py-2.5 bg-[#1C1C1C] text-gray-100 rounded-lg border border-gray-800/50 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 disabled:opacity-70"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Username</label>
                        <input
                          type="text"
                          value={editingCredential.username}
                          onChange={(e) =>
                            setEditingCredential({
                              ...editingCredential,
                              username: e.target.value,
                            })
                          }
                          className="w-full px-4 py-2.5 bg-[#1C1C1C] text-gray-100 rounded-lg border border-gray-800/50 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 hover:border-gray-700/50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Password</label>
                        <input
                          type="password"
                          value={editingCredential.password}
                          onChange={(e) =>
                            setEditingCredential({
                              ...editingCredential,
                              password: e.target.value,
                            })
                          }
                          className="w-full px-4 py-2.5 bg-[#1C1C1C] text-gray-100 rounded-lg border border-gray-800/50 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all duration-300 hover:border-gray-700/50"
                        />
                      </div>
                      <div className="flex justify-end gap-3 mt-4">
                        <button
                          onClick={() => setEditingCredential(null)}
                          className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors duration-300 rounded-lg hover:bg-gray-800/50 backdrop-blur-sm border border-gray-800/10"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          className="px-4 py-2 bg-green-500/90 text-white rounded-lg hover:bg-green-500/80 transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg shadow-green-500/20 active:scale-95 backdrop-blur-sm border border-green-400/20"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-white font-medium">{cred.hostname}</h3>
                          <p className="text-gray-300 text-sm mt-1">Click edit to manage credentials</p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEdit(cred)}
                            className="p-2 text-gray-300 hover:text-white transition-colors duration-300 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(cred.client_ip)}
                            className="p-2 text-gray-300 hover:text-red-400 transition-colors duration-300 hover:bg-gray-800/50 rounded-lg backdrop-blur-sm border border-gray-800/10"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHCredentialsModal;