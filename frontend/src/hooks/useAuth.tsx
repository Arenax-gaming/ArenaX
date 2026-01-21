import { useState, useEffect, createContext, useContext } from 'react';
import { AuthUser, LoginRequest, RegisterRequest, AuthResponse } from '../types';

interface AuthContextType {
  user: AuthUser | null;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (userData: RegisterRequest) => Promise<void>;
  logout: () => void;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for stored auth token on mount
    const token = localStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token');

    if (token && refreshToken) {
      // TODO: Validate token and fetch user profile
      // For now, just set loading to false
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (credentials: LoginRequest) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data: AuthResponse = await response.json();

      // Store tokens
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('refresh_token', data.refreshToken);

      setUser({
        ...data.user,
        token: data.token,
        refreshToken: data.refreshToken,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData: RegisterRequest) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      if (!response.ok) {
        throw new Error('Registration failed');
      }

      const data: AuthResponse = await response.json();

      // Store tokens
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('refresh_token', data.refreshToken);

      setUser({
        ...data.user,
        token: data.token,
        refreshToken: data.refreshToken,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    setError(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
};