import * as jwt from 'jsonwebtoken';
import { NextApiRequest } from 'next';
import BigCommerce from 'node-bigcommerce';
import { ApiConfig, QueryParams, SessionContextProps, SessionProps } from '../types';
import db from './db';
import { getPrimaryStoreConnection } from './db';

const { API_URL, AUTH_CALLBACK, CLIENT_ID, CLIENT_SECRET, JWT_KEY, LOGIN_URL } = process.env;

// Used for internal configuration; 3rd party apps may remove
const apiConfig: ApiConfig = {};
if (API_URL && LOGIN_URL) {
    apiConfig.apiUrl = API_URL;
    apiConfig.loginUrl = LOGIN_URL;
}

// Create BigCommerce instance
// https://github.com/bigcommerce/node-bigcommerce/
const bigcommerce = new BigCommerce({
    logLevel: 'info',
    clientId: CLIENT_ID,
    secret: CLIENT_SECRET,
    callback: AUTH_CALLBACK,
    responseType: 'json',
    headers: { 'Accept-Encoding': '*' },
    apiVersion: 'v3',
    ...apiConfig,
});

const bigcommerceSigned = new BigCommerce({
    secret: CLIENT_SECRET,
    responseType: 'json',
});

export function bigcommerceClient(accessToken: string, storeHash: string, apiVersion = 'v3') {
    return new BigCommerce({
        clientId: CLIENT_ID,
        accessToken,
        storeHash,
        responseType: 'json',
        apiVersion,
        ...apiConfig,
    });
}

// Authorizes app on install
export async function getBCAuth(query: QueryParams) {
    return await bigcommerce.authorize(query);
}
// Verifies app on load/ uninstall
export async function getBCVerify({ signed_payload_jwt }: QueryParams) {
    return await bigcommerceSigned.verifyJWT(signed_payload_jwt);
}

export async function setSession(session: SessionProps) {
    await Promise.all([
      db.setUser(session),
      db.setStore(session),
      db.setStoreUser(session),
    ]);
  }

export async function getSession({ query: { context = '' } }: NextApiRequest) {
    if (typeof context !== 'string') return;
    const { context: storeHash, user } = decodePayload(context) as SessionProps;
    const hasUser = await db.hasStoreUser(storeHash, String(user?.id));

    // Before retrieving session/ hitting APIs, check user
    if (!hasUser) {
        throw new Error('User is not available. Please login or ensure you have access permissions.');
    }

    const accessToken = await db.getStoreToken(storeHash);

    return { accessToken, storeHash, user };
}

export async function getSystemSessionContext(): Promise<SessionContextProps> {
    const store = await getPrimaryStoreConnection();
    if (!store?.accessToken || !store.storeHash) {
        throw new Error('No BigCommerce store connection is configured for background execution.');
    }

    return {
        accessToken: store.accessToken,
        storeHash: store.storeHash,
        user: {
            id: 0,
            email: 'system@merchmonk.local',
            username: 'system',
        },
    };
}

// JWT functions to sign/ verify 'context' query param from /api/auth||load
export function encodePayload({ user, owner, ...session }: SessionProps) {
    const contextString = session?.context ?? session?.sub;
    const context = contextString.split('/')[1] || '';

    return jwt.sign({ context, user, owner }, JWT_KEY, { expiresIn: '24h' });
}
// Verifies JWT for getSession (product APIs)
export function decodePayload(encodedContext: string) {
    return jwt.verify(encodedContext, JWT_KEY);
}

// Removes store and storeUser on uninstall
export async function removeDataStore(session: SessionProps) {
    await Promise.all([
        db.deleteStore(session),
        db.deleteUser(session),
    ]);
}

// Removes users from app - getSession() for user will fail after user is removed
export async function removeUserData(session: SessionProps) {
    await db.deleteUser(session);
}

// Removes user from storeUsers on logout
export async function logoutUser({ storeHash, user }: SessionContextProps) {
    const session = { context: `store/${storeHash}`, user };
    await db.deleteUser(session);
}
