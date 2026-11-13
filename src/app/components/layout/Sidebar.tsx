// src/app/components/layout/Sidebar.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users,
  Clock,
  FileCheck2,
  Briefcase,
  ShieldCheck,
  HardHat,
  FileSignature,
  LogOut,
  Building2,
  SliceIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

const navItems: NavItem[] = [
  {
    label: 'Gestión de Usuarios',
    href: '/dashboard/users',
    icon: Users,
  },
  {
    label: 'Control de Asistencia',
    href: '/dashboard/attendance',
    icon: Clock,
  },
  {
    label: 'Permisos y Papeletas',
    href: '/dashboard/permissions',
    icon: FileCheck2,
  },
  {
    label: 'Reportes y Pre-Nómina',
    href: '/dashboard/payroll',
    icon: Briefcase,
  },
  {
    label: 'Auditoría e ISO 27001',
    href: '/dashboard/audit',
    icon: ShieldCheck,
    badge: 'ISO',
  },
  {
    label: 'Seguridad y Salud (SST)',
    href: '/dashboard/sst',
    icon: HardHat,
    badge: 'Ley 29783',
  },
  {
    label: 'Firma Digital de Boletas',
    href: '/dashboard/digital-signature',
    icon: FileSignature,
  },
  {
    label: 'Políticas de Planilla',
    href: '/dashboard/policies',
    icon: SliceIcon,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [userInfo, setUserInfo] = useState<{ name: string; role: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Cargar datos del usuario desde localStorage para mostrarlos en el pie del sidebar
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUserInfo({
          name: parsed.name || 'Panel RRHH',
          role: parsed.role || 'ADMIN',
        });
      }
    } catch {
      // Ignorar errores de parseo
    }
  }, []);

  // Función de Cierre de Sesión
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    } finally {
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
  };

  // Iniciales del usuario para el avatar
  const initials = userInfo?.name
    ? userInfo.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'HR';

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen border-r border-slate-800 fixed left-0 top-0 z-40">
      {/* BRANDING CABECERA HYPERION */}
      <div className="p-5 border-b border-slate-800 flex items-center space-x-3 bg-slate-950">
        <div className="w-10 h-10 rounded-xl bg-[#005F87] flex items-center justify-center border border-[#00BFA5]/50 shadow-md shadow-[#00BFA5]/10">
          <Building2 className="w-6 h-6 text-[#00BFA5]" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider text-white">
            HYPERION
          </h1>
          <p className="text-[10px] text-[#00BFA5] font-semibold tracking-wider">
            DIGITAL SECURITY S.A.C.
          </p>
        </div>
      </div>

      {/* MENÚ DE NAVEGACIÓN */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          Módulos de Gestión RRHH
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 group ${
                isActive
                  ? 'bg-[#005F87] text-white shadow-lg shadow-[#005F87]/30 border-l-4 border-[#00BFA5]'
                  : 'hover:bg-slate-800/80 hover:text-white text-slate-400'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive
                      ? 'text-[#00BFA5]'
                      : 'text-slate-400 group-hover:text-[#00BFA5]'
                  }`}
                />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                    isActive
                      ? 'bg-[#00BFA5] text-slate-950'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* FOOTER DEL MENU CON ROL Y LOGOUT */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-800 shrink-0 flex items-center justify-center text-xs font-bold text-[#00BFA5] border border-slate-700">
              {initials}
            </div>
            <div className="text-left truncate">
              <p className="text-xs font-medium text-white truncate">
                {userInfo?.name || 'Panel RRHH'}
              </p>
              <p className="text-[10px] text-[#00BFA5] font-semibold">
                {userInfo?.role === 'ADMIN' ? 'Gerencia / Admin' : 'Recursos Humanos'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            title="Cerrar Sesión"
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors shrink-0 cursor-pointer disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}