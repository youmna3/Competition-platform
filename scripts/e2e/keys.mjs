import crypto from 'node:crypto';
const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const b = b64(p); return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`; };
console.log(sign({ role: 'anon', iss: 'supabase', iat: 1700000000, exp: 2000000000 }));
console.log(sign({ role: 'service_role', iss: 'supabase', iat: 1700000000, exp: 2000000000 }));
