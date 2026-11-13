import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = new TextEncoder().encode(
  process.env.JWT_SECRET || 'hyperion_super_secret_jwt_key_2026_sunafil'
);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  const isApiRoute = pathname.startsWith('/api/');

  // Excepción: Permitir que los empleados envíen solicitudes de permiso desde la app (POST)
  // sin tener cookie gerencial; pero proteger GET, PUT y DELETE de permisos para RRHH.
  if (pathname === '/api/v1/hr/permissions' && method === 'POST') {
    return NextResponse.next();
  }

  // Si ya tiene sesión gerencial activa e intenta ir a /login, redirigir al dashboard
  if (pathname === '/login') {
    const token = req.cookies.get('hyperion_session')?.value;
    if (token) {
      try {
        const { payload } = await jwtVerify(token, secretKey);
        if (payload.role === 'ADMIN' || payload.role === 'HR') {
          return NextResponse.redirect(new URL('/dashboard', req.url));
        }
      } catch {
        // Token inválido o expirado: permitir ver /login
      }
    }
    return NextResponse.next();
  }

  // Validar sesión para rutas protegidas (/dashboard/* y APIs administrativas)
  const token = req.cookies.get('hyperion_session')?.value;

  if (!token) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'No autenticado. Se requiere sesión gerencial activa.' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, secretKey);

    // Verificar estrictamente que el rol sea ADMIN o HR
    if (payload.role !== 'ADMIN' && payload.role !== 'HR') {
      if (isApiRoute) {
        return NextResponse.json(
          { error: 'Acceso denegado. Permisos insuficientes para esta operación.' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url));
    }

    // Inyectar cabeceras internas verificadas para que los endpoints puedan leer el usuario real
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-auth-user-id', String(payload.userId || ''));
    requestHeaders.set('x-auth-user-role', String(payload.role || ''));
    requestHeaders.set('x-auth-company-id', String(payload.companyId || ''));

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch {
    if (isApiRoute) {
      const response = NextResponse.json(
        { error: 'Sesión expirada o token inválido.' },
        { status: 401 }
      );
      response.cookies.delete('hyperion_session');
      return response;
    }

    const response = NextResponse.redirect(new URL('/login?error=expired', req.url));
    response.cookies.delete('hyperion_session');
    return response;
  }
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/api/v1/admin/:path*',
    '/api/v1/hr/:path*',
    '/api/v1/users/:path*',
    '/api/v1/reports/:path*',
  ],
};