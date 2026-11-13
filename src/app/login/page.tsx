'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Lock, User, AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, portal: 'ADMIN' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesión');
        setLoading(false);
        return;
      }

      // Guardar datos del administrador en localStorage para trazabilidad en modales
      localStorage.setItem('user', JSON.stringify(data.user));

      // Redirigir al panel principal
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError('Error de conexión con el servidor.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-[#00BFA5] selection:text-slate-950">
      {/* Tarjeta Principal */}
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        {/* Cabecera */}
        <div className="p-8 pb-6 text-center border-b border-slate-800/80 bg-gradient-to-b from-slate-900 to-slate-900/50">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#00BFA5]/10 border border-[#00BFA5]/30 flex items-center justify-center mb-4 shadow-inner">
            <ShieldCheck className="w-8 h-8 text-[#00BFA5]" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Portal Gerencial de Asistencia
          </h1>
          <p className="text-xs text-slate-400 mt-1.5">
            Hyperion Digital Security S.A.C. • Gestión RRHH & SUNAFIL
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleLogin} className="p-8 pt-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Correo Corporativo o DNI
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                autoComplete="username"
                placeholder="gerencia@hyperion.pe o 70123456"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-[#00BFA5] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-[#00BFA5] rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#00BFA5] hover:bg-[#00a892] disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm shadow-lg shadow-[#00BFA5]/10 transition cursor-pointer"
          >
            {loading ? 'Verificando credenciales...' : 'Ingresar al Sistema'}
          </button>
        </form>

        {/* Pie */}
        <div className="px-8 py-4 bg-slate-950/60 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            Acceso auditado conforme al D.S. N° 004-2006-TR. Uso exclusivo personal autorizado.
          </p>
        </div>
      </div>
    </div>
  );
}