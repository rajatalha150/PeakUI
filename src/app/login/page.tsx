"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Lock, User, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getPasswordPolicyText } from '@/lib/auth-validation';

export default function LoginPage() {
  const [isSetupNeeded, setIsSetupNeeded] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(data => setIsSetupNeeded(data.isSetupNeeded))
      .catch(() => setIsSetupNeeded(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    if (isSetupNeeded && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to authenticate');
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  if (isSetupNeeded === null) return null; // loading state

  return (
    <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '40px', position: 'relative', overflow: 'hidden' }}>
        
        <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '150px', height: '150px', background: 'var(--accent-primary)', filter: 'blur(80px)', opacity: 0.3, zIndex: 0 }}></div>
        <div style={{ position: 'absolute', bottom: '-50px', left: '-50px', width: '150px', height: '150px', background: 'var(--accent-secondary)', filter: 'blur(80px)', opacity: 0.2, zIndex: 0 }}></div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              position: 'relative',
              width: '80px', height: '80px',
              background: 'var(--accent-gradient)',
              borderRadius: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px var(--accent-glow)',
              overflow: 'hidden',
            }}>
              <Image src="/logo.png" alt="PeakUI" fill style={{ objectFit: 'contain', padding: '4px' }} sizes="80px" priority />
            </div>
            <h1 style={{ fontSize: '1.8rem', margin: 0 }}>PeakUI</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '0.9rem' }}>
              {isSetupNeeded ? 'Create your initial Admin account to secure the studio.' : 'Welcome back. Please log in to your studio.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {error && (
              <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem', textAlign: 'center' }}>
                {error}
              </div>
            )}
            
            <div style={{ position: 'relative' }}>
              <User size={18} color="var(--text-secondary)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="text" 
                className="input-field" 
                placeholder="Username" 
                style={{ paddingLeft: '44px' }}
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Lock size={18} color="var(--text-secondary)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="password" 
                className="input-field" 
                placeholder="Password" 
                style={{ paddingLeft: '44px' }}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            {isSetupNeeded && (
              <>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} color="var(--text-secondary)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Confirm Password"
                    style={{ paddingLeft: '44px' }}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '-6px' }}>
                  {getPasswordPolicyText()}
                </div>
              </>
            )}

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ marginTop: '8px', padding: '14px', width: '100%' }}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : (isSetupNeeded ? 'Create Admin Account' : 'Secure Login')}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
