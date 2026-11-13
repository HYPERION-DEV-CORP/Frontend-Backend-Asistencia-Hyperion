import { NextResponse } from 'next/server';

function clearSessionCookie() {
  const response = NextResponse.json({
    success: true,
    message: 'Sesión cerrada correctamente',
  });

  response.cookies.set('hyperion_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // Fuerza la eliminación inmediata en el navegador
  });

  return response;
}

export async function POST() {
  return clearSessionCookie();
}

export async function GET() {
  return clearSessionCookie();
}