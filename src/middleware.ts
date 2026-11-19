// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = new TextEncoder().encode(
  process.env.JWT_SECRET || 'hyperion_super_secret_jwt_key_2026_sunafil'
);

// Helper para inyectar cabeceras CORS en respuestas de API (necesario para Flutter Web)
function applyCorsHeaders(res: NextResponse, origin: string | null) {
  res.headers.set('Access-Control-Allow-Origin', origin || '*');
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept'
  );
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  const isApiRoute = pathname.startsWith('/api/');
  const origin = req.headers.get('origin');

  // 1. Responder de inmediato a peticiones Preflight (OPTIONS) de navegadores / Flutter Web
  if (isApiRoute && method === 'OPTIONS') {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  // 2. Rutas públicas de API usadas por la App Móvil / Web (Login, Recuperación, Perfil/Firma, Marcaciones, Tareo SUNAFIL, Domicilios)
  const isPublicMobileApi =
    pathname.startsWith('/api/v1/auth/') ||
    pathname.startsWith('/api/v1/attendance') ||
    pathname.startsWith('/api/v1/home-addresses') ||
    pathname.startsWith('/api/v1/users/') ||
    pathname.startsWith('/api/v1/reports/attendance-sheet') ||
    (pathname === '/api/v1/hr/permissions' && method === 'POST');

  if (isPublicMobileApi) {
    return applyCorsHeaders(NextResponse.next(), origin);
  }

  // 3. Si ya tiene sesión gerencial activa e intenta ir a /login, redirigir al dashboard
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

  // 4. Validar sesión para rutas protegidas (/dashboard/* y APIs administrativas)
  const token = req.cookies.get('hyperion_session')?.value;

  if (!token) {
    if (isApiRoute) {
      return applyCorsHeaders(
        NextResponse.json(
          { error: 'No autenticado. Se requiere sesión gerencial activa.' },
          { status: 401 }
        ),
        origin
      );
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, secretKey);

    // Verificar estrictamente que el rol sea ADMIN o HR
    if (payload.role !== 'ADMIN' && payload.role !== 'HR') {
      if (isApiRoute) {
        return applyCorsHeaders(
          NextResponse.json(
            { error: 'Acceso denegado. Permisos insuficientes para esta operación.' },
            { status: 403 }
          ),
          origin
        );
      }
      return NextResponse.redirect(new URL('/login?error=unauthorized', req.url));
    }

    // Inyectar cabeceras internas verificadas para que los endpoints puedan leer el usuario real
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-auth-user-id', String(payload.userId || ''));
    requestHeaders.set('x-auth-user-role', String(payload.role || ''));
    requestHeaders.set('x-auth-company-id', String(payload.companyId || ''));

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    return isApiRoute ? applyCorsHeaders(response, origin) : response;
  } catch {
    if (isApiRoute) {
      const response = NextResponse.json(
        { error: 'Sesión expirada o token inválido.' },
        { status: 401 }
      );
      response.cookies.delete('hyperion_session');
      return applyCorsHeaders(response, origin);
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
    '/api/:path*',
  ],
};